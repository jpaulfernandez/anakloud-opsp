import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import {
  findPublicSourceAnswer,
  listSourceAnswerRows,
} from "./answers";
import {
  latestOfficialDraft,
  writeOfficialCellsVersion,
  OfficialDraftNotFoundError,
  type OfficialCell,
  type OfficialSourceCard,
} from "./official-opsp";
import { OPSP_CELL_IDS, type OpspCellId } from "./opsp";
import { QUESTION_IDS, type QuestionId } from "./questions";
import { formatAnswerSummary, type DisplayNameResolver } from "./review";

// Source cards (F15-T02, FR-37, ui_ux.md §4.20): the facilitator attaches any
// respondent's answer to any official cell as a small card under the cell,
// attributed to the respondent. The card pools every non-private answer in the
// cohort; the cohort's Q14(d) private rows are structurally absent because the
// pool is read through lib/answers.ts (F01-T03), whose SQL filters
// `is_private = false` — never in a filter step someone could forget.
//
// Attaching and removing a card each write a NEW official-draft version and
// never modify any answers row (PR5): the only write reachable from here is a
// new `opsp_drafts` version via writeOfficialCellsVersion, so a card added or
// removed on the canvas cannot touch the underlying answer. Each card stores a
// self-contained snapshot — respondent name, question id and the answer's
// preformatted text — so removing a card, however it later happens, leaves the
// answer row exactly as it was.

/** Thrown when the source answer for an attach is missing, private or out of cohort. */
export class SourceCardUnavailableError extends Error {
  constructor() {
    super("the chosen answer is not available to attach");
    this.name = "SourceCardUnavailableError";
  }
}

/** One candidate in the picker: a respondent's non-private answer. */
export interface SourceCardCandidate {
  respondentId: string;
  respondentName: string;
  questionId: QuestionId;
  /** The answer rendered to readable text, reused verbatim on the card. */
  text: string;
}

/** A validated `{ cellId, respondentId, questionId }` attach body. */
export interface AttachSourceCardInput {
  cellId: OpspCellId;
  respondentId: string;
  questionId: QuestionId;
}

/** A validated `{ cellId, cardId }` remove body. */
export interface RemoveSourceCardInput {
  cellId: OpspCellId;
  cardId: string;
}

/**
 * Validate and normalise an attach body. Accepts `{ cellId, respondentId,
 * questionId }`. `questionId` must be a real question id — 'q14d' is not one,
 * so a private-row attach is refused before it reaches the SQL. Returns null
 * for a malformed body.
 */
export function parseAttachInput(body: unknown): AttachSourceCardInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.cellId !== "string" || !(OPSP_CELL_IDS as readonly string[]).includes(b.cellId)) {
    return null;
  }
  if (typeof b.respondentId !== "string" || b.respondentId === "") return null;
  if (typeof b.questionId !== "string" || !(QUESTION_IDS as readonly string[]).includes(b.questionId)) {
    return null;
  }
  return {
    cellId: b.cellId as OpspCellId,
    respondentId: b.respondentId,
    questionId: b.questionId as QuestionId,
  };
}

/** Validate and normalise a remove body (`{ cellId, cardId }`). */
export function parseRemoveInput(body: unknown): RemoveSourceCardInput | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.cellId !== "string" || !(OPSP_CELL_IDS as readonly string[]).includes(b.cellId)) {
    return null;
  }
  if (typeof b.cardId !== "string" || b.cardId === "") return null;
  return { cellId: b.cellId as OpspCellId, cardId: b.cardId };
}

/** Build a respondent-id → display-name resolver from the cohort roster. */
async function cohortNameResolver(
  db: ClientBase,
  cohortId: string,
): Promise<DisplayNameResolver> {
  const { rows } = await db.query<{ id: string; display_name: string | null }>(
    `select id, display_name from respondents where cohort_id = $1`,
    [cohortId],
  );
  const byId = new Map(rows.map((r) => [r.id, r.display_name ?? ""]));
  return (rid) => byId.get(rid);
}

/**
 * The picker's pool: every non-private answer in the cohort, attributed to its
 * respondent and rendered to text. Reads through lib/answers.ts (F01-T03),
 * which filters `is_private = false` in the SQL, so the Q14(d) note never
 * appears here (F15-T02 acceptance). Runs inside the facilitator's RLS context
 * so cohort-wide answers are visible.
 */
export async function listSourceCardCandidates(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
): Promise<SourceCardCandidate[]> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const nameOf = await cohortNameResolver(tx, cohortId);
    const rows = await listSourceAnswerRows(tx, cohortId);
    return rows.map((row) => ({
      respondentId: row.respondent_id,
      respondentName: row.respondent_name,
      questionId: row.question_id as QuestionId,
      text: formatAnswerSummary(row.question_id as QuestionId, row.value, nameOf),
    }));
  });
}

/**
 * Attach a respondent's answer to an official cell as a source card, writing a
 * NEW official-draft version and never touching any answers row. The chosen
 * answer is re-verified inside this transaction: it must exist, belong to the
 * cohort, and be non-private — a 'q14d' request (or any missing/foreign row)
 * throws SourceCardUnavailableError before any card is written (FR-37 SHALL NOT
 * offer is_private rows in the picker). Returns the new version and its cells.
 */
export async function attachSourceCard(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  input: AttachSourceCardInput,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const draft = await latestOfficialDraft(tx, cohortId);
    if (!draft) throw new OfficialDraftNotFoundError();
    const target = draft.cells[input.cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    // Re-verify the source answer here: it must exist, belong to the cohort,
    // and be non-private. findPublicSourceAnswer filters is_private = false in
    // the SQL (F01-T03), so a 'q14d' request never matches and throws.
    const row = await findPublicSourceAnswer(
      tx,
      cohortId,
      input.respondentId,
      input.questionId,
    );
    if (!row) throw new SourceCardUnavailableError();

    const card: OfficialSourceCard = {
      id: randomUUID(),
      respondentId: input.respondentId,
      respondentName: row.respondent_name,
      questionId: input.questionId,
      text: formatAnswerSummary(
        input.questionId,
        row.value,
        await cohortNameResolver(tx, cohortId),
      ),
    };

    const updated: Record<OpspCellId, OfficialCell> = {
      ...draft.cells,
      [input.cellId]: { ...target, sourceCards: [...target.sourceCards, card] },
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/**
 * Remove a source card from an official cell, writing a NEW official-draft
 * version and never touching any answers row — the underlying answer is
 * untouched (F15-T02 acceptance). Removing a card that isn't present is a
 * no-op returning the current version. Returns the new version and its cells.
 */
export async function removeSourceCard(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  input: RemoveSourceCardInput,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const draft = await latestOfficialDraft(tx, cohortId);
    if (!draft) throw new OfficialDraftNotFoundError();
    const target = draft.cells[input.cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    const remaining = target.sourceCards.filter((card) => card.id !== input.cardId);
    if (remaining.length === target.sourceCards.length) {
      // The card wasn't attached to this cell — nothing to remove.
      return { version: draft.version, cells: draft.cells };
    }

    const updated: Record<OpspCellId, OfficialCell> = {
      ...draft.cells,
      [input.cellId]: { ...target, sourceCards: remaining },
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}