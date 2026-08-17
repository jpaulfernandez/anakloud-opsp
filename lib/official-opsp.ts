import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import { applyCellEdit } from "./opsp-edit";
import type { QuestionId } from "./questions";
import {
  OPSP_CELL_IDS,
  type OpspCell,
  type OpspCellId,
} from "./opsp";

// The official OPSP canvas's persistence and authoring (F15-T01, FR-36,
// ui_ux.md §4.20). The collaborative plan is an `opsp_drafts` row with
// `owner_type = 'official'` and a null owner_id — the team's plan, not any one
// respondent's — scoped to the cohort (one lineage per cohort, enforced by the
// 0011 partial unique index on version 1). Authoring is restricted to the
// cohort's facilitator: every query here runs inside the facilitator's RLS
// context so the 0011 drafts_official_* policies admit their writes and the
// cohort-wide read, and a respondent acting in this code path would find the
// policies reject every write (migration 0011 describes why).
//
// The official canvas starts blank — sixteen cells, each an empty OpspCell —
// because the collaborative plan is not derived from anyone's snapshot; the
// facilitator authors it during the session, and later F15 tickets (source
// cards, synthesis) attach respondents' answers to it. Edits reuse the same
// cell-edit machinery as the individual OPSP (applyCellEdit) and write a NEW
// version, never mutating a prior one, exactly like F07-T05.

/** The official draft's owner_type value, stored in opsp_drafts. */
export const OFFICIAL_OWNER_TYPE = "official";

/** Thrown when an official edit targets a cell/draft that does not exist. */
export class OfficialDraftNotFoundError extends Error {
  constructor() {
    super("no official OPSP draft for this cohort");
    this.name = "OfficialDraftNotFoundError";
  }
}

/** Thrown when an accept/discard targets a cell that has no pending AI draft. */
export class NoOfficialDraftPendingError extends Error {
  constructor() {
    super("this cell has no AI-drafted statement to accept or discard");
    this.name = "NoOfficialDraftPendingError";
  }
}

/** Thrown when a record-decision targets a cell that has no conflict. */
export class NoOfficialConflictError extends Error {
  constructor() {
    super("this cell has no conflict to record a decision for");
    this.name = "NoOfficialConflictError";
  }
}

/** Thrown when a recorded decision picks a position that is not in the conflict. */
export class UnknownConflictPositionError extends Error {
  constructor() {
    super("the chosen position is not one of the conflict's positions");
    this.name = "UnknownConflictPositionError";
  }
}

/**
 * A recorded decision on a conflict cell (F15-T05, FR-39, ui_ux.md §4.20):
 * the note of which position was chosen and by whom. The chosen position's
 * text is stored as the cell's published content at the same time; this record
 * keeps both the choice and the decider after the fact, so the note survives a
 * reload and a snapshot.
 */
export interface OfficialCellDecision {
  /** The id of the chosen position card. */
  positionId: string;
  /** The chosen position's text, now the cell's published content. */
  chosenText: string;
  /** The id of the respondent (the facilitator) who recorded the decision. */
  recorderId: string;
  /** The display name of whoever recorded the decision, for the note. */
  recorderName: string;
  /** ISO timestamp of the recording. */
  recordedAt: string;
}

/**
 * A conflict result state on an official cell (F15-T05, FR-39, ui_ux.md §4.20):
 * the guard refused to synthesise two or more positions, so the cell holds both
 * positions side by side for the room to choose. `positions` is a self-contained
 * snapshot of the attached source cards at the moment the conflict was struck —
 * it survives later card removals and version snapshots — and `decision`
 * records the human choice once made. There is deliberately no merged text
 * anywhere on this state: the absence of a merge affordance is the feature.
 */
export interface OfficialCellConflict {
  /** Stable id for the conflict state. */
  id: string;
  /** Why the guard refused — states both positions in their own words. */
  reason: string;
  /** The positions side by side, snapshot so they survive card removal. */
  positions: OfficialSourceCard[];
  /** The recorded human decision, present exactly once a position is chosen. */
  decision?: OfficialCellDecision;
}

/** Build the conflict result state for a cell from its source cards (pure). */
export function buildOfficialCellConflict(
  sourceCards: OfficialSourceCard[],
  reason: string,
): OfficialCellConflict {
  return {
    id: randomUUID(),
    reason,
    positions: sourceCards.map((card) => ({ ...card })),
  };
}

/**
 * A statement the planner drafted for one cell that has NOT yet been accepted
 * into the team's plan (F15-T04, FR-40). It lives on the cell separately from
 * the published `value`, so an AI-drafted cell is visibly a draft and only
 * enters the official OPSP through an explicit human accept. `sourceQuestionIds`
 * records which source questions fed the draft, carried forward as a cell's
 * provenance once the draft is accepted.
 */
export interface OfficialCellDraft {
  /** Stable id for the pending draft. */
  id: string;
  /** The AI-drafted one-line statement, pending explicit acceptance. */
  statement: string;
  /** The question ids of the source cards that fed the draft, deduplicated. */
  sourceQuestionIds: string[];
}

/** Build the pending-draft state for a cell from its source cards and the
 * statement the planner drafted. The accepted provenance comes from the order
 * the cards were attached, so question ids are deduplicated in that order. */
export function buildOfficialCellDraft(
  sourceCards: OfficialSourceCard[],
  statement: string,
): OfficialCellDraft {
  const sourceQuestionIds = [...new Set(sourceCards.map((card) => card.questionId))];
  return { id: randomUUID(), statement, sourceQuestionIds };
}

/**
 * One respondent's answer attached to an official cell (F15-T02, FR-37,
 * ui_ux.md §4.20). The card is self-contained — it carries the respondent's
 * name (attribution), the question the answer came from, and a preformatted
 * text rendering of the answer — so it renders under the cell without a join
 * and survives version snapshots. `text` is computed once at attach time from
 * the stored answer via the same formatter the review screen uses; it is never
 * re-derived at render, so a card is stable even if answer formatting changes.
 * The card stores a snapshot of the answer, never a reference whose later
 * silence would leave a hole.
 */
export interface OfficialSourceCard {
  /** Stable id; removal targets a specific card. */
  id: string;
  respondentId: string;
  /** Attribution label shown on the card. */
  respondentName: string;
  /** The source question ('q1'..'q15'); never 'q14d'. */
  questionId: string;
  /** The answer rendered to readable text at attach time. */
  text: string;
}

/**
 * One cell-level provenance entry (F15-T06, FR-41): a record of which
 * respondent's answer fed an accepted official cell, and from which question.
 * Unlike the individual plan's question-only `sources`, an official cell's
 * provenance names the respondent too, so an accepted cell can read "from Ern
 * (Q7), Paul (Q7)". It is written once when a cell is accepted — either via a
 * household synthesis or a recorded decision — and lives on the cell, so it
 * survives version snapshots and reloads.
 */
export interface OfficialCellProvenance {
  /** The respondent whose answer fed the cell. */
  respondentId: string;
  /** Attribution label shown in the provenance line. */
  respondentName: string;
  /** The question that answer came from ('q1'..'q15'); never 'q14d'. */
  questionId: string;
}

/**
 * Build a cell's provenance from its attached source cards (F15-T06, FR-41),
 * deduplicating to one entry per (respondent, question) in attachment order.
 * Used when a draft is accepted, so the accepted cell records exactly which
 * respondents' answers fed it and from which questions. Pure: no I/O.
 */
export function buildSourceCardProvenance(
  cards: readonly OfficialSourceCard[],
): OfficialCellProvenance[] {
  const seen = new Set<string>();
  const out: OfficialCellProvenance[] = [];
  for (const card of cards) {
    const key = `${card.respondentId}\u0000${card.questionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      respondentId: card.respondentId,
      respondentName: card.respondentName,
      questionId: card.questionId,
    });
  }
  return out;
}

/**
 * An official OPSP cell: the same OpspCell shape as the individual plan plus
 * the source cards attached to it. The official canvas starts without any
 * published cell content but can carry cards under each cell as the
 * facilitator pulls answers in from the cohort.
 */
export interface OfficialCell extends OpspCell {
  sourceCards: OfficialSourceCard[];
  /** The pending AI-drafted statement, if one awaits explicit acceptance. */
  draft?: OfficialCellDraft;
  /** The conflict result state, when the guard refused to synthesise. */
  conflict?: OfficialCellConflict;
  /**
   * Cell-level provenance (F15-T06, FR-41): which respondents' answers fed
   * this accepted cell and from which questions. Set when a draft is accepted
   * or a decision is recorded; survives version snapshots with the cell.
   */
  provenance: OfficialCellProvenance[];
}

/** Ensure an OpspCell (possibly a pre-F15-T02 row) carries a sourceCards array. */
function toOfficialCell(cell: OpspCell): OfficialCell {
  const sourceCards = Array.isArray((cell as Partial<OfficialCell>).sourceCards)
    ? (cell as OfficialCell).sourceCards
    : [];
  const draft = (cell as Partial<OfficialCell>).draft;
  const conflict = (cell as Partial<OfficialCell>).conflict;
  // Provenance (F15-T06) read leniently: a legacy/pre-provenance cell falls
  // back to an empty list rather than a malformed one, so the renderer never
  // sees a provenance line it cannot trust.
  const rawProvenance = (cell as Partial<OfficialCell>).provenance;
  const provenance = Array.isArray(rawProvenance)
    ? rawProvenance.filter(isOfficialCellProvenance)
    : [];
  // Normalise a legacy/foreign draft or conflict shape so a malformed cell
  // never surfaces a pending statement or a decision state that cannot act.
  const cleanDraft = isOfficialCellDraft(draft) ? draft : undefined;
  const cleanConflict = isOfficialCellConflict(conflict) ? conflict : undefined;
  return { ...cell, sourceCards, provenance, draft: cleanDraft, conflict: cleanConflict };
}

/** True for a well-formed pending AI draft. Anything else is dropped on read. */
function isOfficialCellDraft(value: unknown): value is OfficialCellDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<OfficialCellDraft>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    typeof v.statement === "string" &&
    Array.isArray(v.sourceQuestionIds) &&
    v.sourceQuestionIds.every((q) => typeof q === "string")
  );
}

/** True for a well-formed conflict state. Anything else is dropped on read. */
function isOfficialCellConflict(value: unknown): value is OfficialCellConflict {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<OfficialCellConflict>;
  if (typeof v.id !== "string" || v.id.length === 0) return false;
  if (typeof v.reason !== "string") return false;
  if (!Array.isArray(v.positions)) return false;
  if (v.positions.some((p) => !isOfficialSourceCard(p))) return false;
  if (v.decision !== undefined) {
    const d = v.decision as Partial<OfficialCellDecision>;
    if (
      typeof d.positionId !== "string" ||
      typeof d.chosenText !== "string" ||
      typeof d.recorderId !== "string" ||
      typeof d.recorderName !== "string" ||
      typeof d.recordedAt !== "string"
    ) {
      return false;
    }
  }
  return true;
}

/** True for a well-formed source card snapshot. */
function isOfficialSourceCard(value: unknown): value is OfficialSourceCard {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Partial<OfficialSourceCard>;
  return (
    typeof c.id === "string" &&
    typeof c.respondentId === "string" &&
    typeof c.respondentName === "string" &&
    typeof c.questionId === "string" &&
    typeof c.text === "string"
  );
}

/** True for a well-formed cell-level provenance entry (F15-T06). */
function isOfficialCellProvenance(value: unknown): value is OfficialCellProvenance {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<OfficialCellProvenance>;
  return (
    typeof p.respondentId === "string" &&
    typeof p.respondentName === "string" &&
    typeof p.questionId === "string"
  );
}

function toOfficialCells(
  cells: Record<OpspCellId, OpspCell>,
): Record<OpspCellId, OfficialCell> {
  const out = {} as Record<OpspCellId, OfficialCell>;
  for (const id of OPSP_CELL_IDS) out[id] = toOfficialCell(cells[id] as OpspCell);
  return out;
}

/** A cohort's latest official OPSP draft row. */
export interface OfficialDraft {
  id: string;
  version: number;
  cells: Record<OpspCellId, OfficialCell>;
}

/**
 * The blank opening canvas for the official OPSP: all sixteen cells present,
 * each an empty pencil cell so the grid matches the individual OPSP's structure
 * with nothing pre-filled (ui_ux.md §4.20 "nothing invented to fill a hole" —
 * the collaborative plan is authored, not auto-derived). No source cards yet.
 */
export function emptyOfficialCells(): Record<OpspCellId, OfficialCell> {
  const cells = {} as Record<OpspCellId, OfficialCell>;
  for (const id of OPSP_CELL_IDS) {
    cells[id] = {
      value: null,
      marking: { type: "single", mark: "pencil" },
      sources: [],
      lowConfidence: false,
      sourceCards: [],
      provenance: [],
    };
  }
  return cells;
}

/**
 * The cohort's latest official draft, or null when no official draft exists.
 * Cells are normalised to OfficialCell so legacy rows written before F15-T02
 * (which had no sourceCards field) read back with an empty card list rather
 * than an undefined one. Runs inside an already-open respondent context (the
 * caller owns the withRespondentContext), so it can be composed with attach /
 * remove in a single transaction. Exported for the source-card path to read
 * the latest cells inside its own context.
 */
export async function latestOfficialDraft(
  db: ClientBase,
  cohortId: string,
): Promise<OfficialDraft | null> {
  const { rows } = await db.query<{ id: string; version: number; cells: unknown }>(
    `select id, version, cells
       from opsp_drafts
      where owner_type = 'official' and cohort_id = $1
      order by version desc
      limit 1`,
    [cohortId],
  );
  const row = rows[0];
  if (!row || row.cells === null || row.cells === undefined) return null;
  return {
    id: row.id,
    version: row.version,
    cells: toOfficialCells(row.cells as Record<OpspCellId, OpspCell>),
  };
}

/**
 * A named, immutable version snapshot of the official OPSP (F15-T07, FR-42).
 * Taking a snapshot records the current plan's cells under a label (e.g. "Q4
 * 2026 v1") as a NEW `opsp_drafts` row. Because every official write — edits,
 * drafts, decisions, snapshots alike — is an insert that never updates a prior
 * row, a snapshot can never be changed after it is taken: the immutability is
 * the versioning contract itself, not an extra rule the edit path must
 * remember. The snapshot row carries the same cells the plan had at the moment
 * it was taken, so "Q4 2026 v1" stays exactly the plan that was current then,
 * no matter how many edits land afterwards.
 */
export interface OfficialSnapshot {
  id: string;
  version: number;
  label: string;
  cells: Record<OpspCellId, OfficialCell>;
}

/** The longest a snapshot label may be; a label is a short human name. */
export const OFFICIAL_SNAPSHOT_MAX_LABEL = 80;

/**
 * Validate and normalise a snapshot label (F15-T07). Pure: no I/O. A label
 * must be a non-empty, trimmed string no longer than the cap; anything else
 * (missing, not a string, whitespace-only, over-length) returns null so the
 * route can answer a single 400.
 */
export function parseOfficialSnapshotLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.trim();
  if (label.length === 0 || label.length > OFFICIAL_SNAPSHOT_MAX_LABEL) return null;
  return label;
}

/**
 * Record a named snapshot of the cohort's official plan (F15-T07, FR-42),
 * writing the current cells under `label` as a NEW draft version. The snapshot
 * row is immutable by the versioning contract — every later edit writes another
 * version and never touches this one. Runs inside the facilitator's RLS context
 * (so only the cohort's facilitator can snapshot), and the single write is
 * `insert into opsp_drafts` — the answers table is never touched (PR5). Throws
 * `OfficialDraftNotFoundError` when the cohort has no official draft yet.
 */
export async function takeOfficialSnapshot(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  label: string,
): Promise<OfficialSnapshot> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();

    const { rows } = await tx.query<{ next: number }>(
      `select coalesce(max(version), 0) + 1 as next
         from opsp_drafts
        where owner_type = 'official' and cohort_id = $1`,
      [cohortId],
    );

    const snapshotId = randomUUID();
    const next = rows[0].next;

    await tx.query(
      `insert into opsp_drafts
         (id, cohort_id, owner_type, owner_id, version, cells, label)
       values ($1, $2, 'official', null, $3, $4::jsonb, $5)`,
      [snapshotId, cohortId, next, JSON.stringify(current.cells), label],
    );

    return { id: snapshotId, version: next, label, cells: current.cells };
  });
}

/**
 * The cohort's named snapshots, newest first (F15-T07, FR-42). Only rows with a
 * non-blank label count as snapshots; plain working versions the edit path
 * writes (label null) are not history entries. Runs inside the facilitator's
 * RLS context so only the cohort's facilitator can list its version history.
 */
export async function listOfficialSnapshots(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
): Promise<OfficialSnapshot[]> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const { rows } = await tx.query<
      { id: string; version: number; label: string | null; cells: unknown }
    >(
      `select id, version, label, cells
         from opsp_drafts
        where owner_type = 'official' and cohort_id = $1
          and label is not null and length(trim(label)) > 0
        order by version desc`,
      [cohortId],
    );
    return rows
      .filter((row) => row.label !== null)
      .map((row) => ({
        id: row.id,
        version: row.version,
        label: row.label as string,
        cells: toOfficialCells(row.cells as Record<OpspCellId, OpspCell>),
      }));
  });
}

/**
 * Fetch one named snapshot by its version number (F15-T07, FR-42), for a
 * read-only view of what the official plan was at that snapshot. Returns null
 * when the version is not a snapshot. Runs inside the facilitator's RLS context
 * like every other official-draft read.
 */
export async function getOfficialSnapshot(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  version: number,
): Promise<OfficialSnapshot | null> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const { rows } = await tx.query<
      { id: string; version: number; label: string | null; cells: unknown }
    >(
      `select id, version, label, cells
         from opsp_drafts
        where owner_type = 'official' and cohort_id = $1
          and version = $2 and label is not null and length(trim(label)) > 0
        limit 1`,
      [cohortId, version],
    );
    const row = rows[0];
    if (!row || row.label === null) return null;
    return {
      id: row.id,
      version: row.version,
      label: row.label,
      cells: toOfficialCells(row.cells as Record<OpspCellId, OpspCell>),
    };
  });
}

/**
 * Write a new version of the cohort's official plan from a complete next set
 * of cells, leaving every prior version untouched (FR-26 lineage semantics).
 * Runs inside an already-open respondent context; the single write is
 * `insert into opsp_drafts` — the answers table is never touched (PR5).
 * Returns the new version number. Shared by the cell-edit path and the
 * source-card attach/remove path so both go through the same versioning.
 */
export async function writeOfficialCellsVersion(
  db: ClientBase,
  cohortId: string,
  cells: Record<OpspCellId, OpspCell>,
): Promise<number> {
  const { rows } = await db.query<{ next: number }>(
    `select coalesce(max(version), 0) + 1 as next
       from opsp_drafts
      where owner_type = 'official' and cohort_id = $1`,
    [cohortId],
  );
  const next = rows[0].next;

  await db.query(
    `insert into opsp_drafts
       (id, cohort_id, owner_type, owner_id, version, cells)
     values ($1, $2, 'official', null, $3, $4::jsonb)`,
    [randomUUID(), cohortId, next, JSON.stringify(cells)],
  );

  return next;
}

/**
 * Fetch the cohort's official draft, creating version 1 (a blank canvas) the
 * first time a facilitator opens it. Idempotent: further calls return the same
 * lineage. Runs inside the facilitator's RLS context, so creation is the only
 * route through which an official row comes into existence and only the
 * cohort's facilitator can cause it. The one-per-cohort guarantee is the 0011
 * unique index; a race that double-inserts version 1 trips it and this fallback
 * re-reads the winner, so the call still resolves to the single lineage.
 */
export async function getOrCreateOfficialDraft(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
): Promise<OfficialDraft> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const existing = await latestOfficialDraft(tx, cohortId);
    if (existing) return existing;

    try {
      await tx.query(
        `insert into opsp_drafts
           (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'official', null, 1, $3::jsonb)`,
        [randomUUID(), cohortId, JSON.stringify(emptyOfficialCells())],
      );
    } catch (err) {
      // The one-per-cohort index fired on a concurrent first-creation; the
      // winning lineage is the answer.
      if (isUniqueViolation(err)) {
        const winner = await latestOfficialDraft(tx, cohortId);
        if (winner) return winner;
      }
      throw err;
    }

    const created = await latestOfficialDraft(tx, cohortId);
    if (!created) throw new OfficialDraftNotFoundError();
    return created;
  });
}

/**
 * Author one cell of the official plan: create a NEW version based on the
 * current (highest-version) cells with the edit applied, leaving every prior
 * version untouched (FR-26 lineage semantics, same as the individual OPSP).
 * Runs inside the facilitator's RLS context, so only the cohort's facilitator
 * can author, and the single write is `insert into opsp_drafts` — the answers
 * table is never touched (PR5). Source cards attached to the targeted cell are
 * carried over unchanged, so editing a cell's text never detaches its cards.
 * Returns the new version and its cells.
 */
export async function createOfficialDraftVersion(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  edit: { cellId: OpspCellId; content?: string | null; mark?: "ink" | "pencil" },
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[edit.cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    const edited: OfficialCell = {
      ...applyCellEdit(target, edit),
      sourceCards: target.sourceCards,
      provenance: target.provenance,
    };

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [edit.cellId]: edited,
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);

    return { version, cells: updated };
  });
}

/**
 * Store a pending AI-drafted statement on one official cell (F15-T04, FR-40),
 * writing a NEW draft version and leaving the cell's published `value` — and
 * every answers row — untouched. The draft is visibly separate from the
 * official plan until it is explicitly accepted, so it never silently enters
 * the team's OPSP.
 */
export async function storeOfficialCellDraft(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  cellId: OpspCellId,
  draft: OfficialCellDraft,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [cellId]: { ...target, draft },
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/**
 * Explicit human acceptance of a pending draft (F15-T04, FR-40): promote the
 * drafted statement into the cell's published `value` as ink, drop the draft,
 * and record the source questions that fed it as the cell's provenance —
 * including which respondents' answers those were (F15-T06, FR-41): question
 * ids go in `sources` and the (respondent, question) pairs go in `provenance`.
 * Writes a NEW draft version — acceptance is a deliberate single action, never
 * automatic. Throws `NoOfficialDraftPendingError` when the cell has nothing to
 * accept.
 */
export async function acceptOfficialCellDraft(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  cellId: OpspCellId,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[cellId];
    if (!target) throw new OfficialDraftNotFoundError();
    const pending = target.draft;
    if (!pending) throw new NoOfficialDraftPendingError();

    const accepted: OfficialCell = {
      ...target,
      value: pending.statement,
      marking: { type: "single", mark: "ink" },
      sources: pending.sourceQuestionIds as QuestionId[],
      lowConfidence: false,
      draft: undefined,
      provenance: buildSourceCardProvenance(target.sourceCards),
    };

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [cellId]: accepted,
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/**
 * Decline a pending draft (F15-T04): clear it without promoting it into the
 * official plan, leaving the cell's published `value` exactly as it was. Writes
 * a NEW draft version. Throws `NoOfficialDraftPendingError` when the cell has
 * nothing to decline.
 */
export async function discardOfficialCellDraft(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  cellId: OpspCellId,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[cellId];
    if (!target) throw new OfficialDraftNotFoundError();
    if (!target.draft) throw new NoOfficialDraftPendingError();

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [cellId]: { ...target, draft: undefined },
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/**
 * Store the conflict result state on one official cell (F15-T05, FR-39,
 * ui_ux.md §4.20), writing a NEW draft version. The guard refused to
 * synthesise, so the cell now holds both positions and offers a human
 * decision; the published `value` is untouched until a decision is recorded.
 * Runs inside the facilitator's RLS context, exactly like the draft path.
 */
export async function storeOfficialCellConflict(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  cellId: OpspCellId,
  conflict: OfficialCellConflict,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [cellId]: { ...target, conflict },
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/** The display name of a respondent, for the "by whom" part of a decision. */
async function respondentDisplayName(
  tx: ClientBase,
  respondentId: string,
): Promise<string> {
  const { rows } = await tx.query<{ display_name: string | null }>(
    `select display_name from respondents where id = $1`,
    [respondentId],
  );
  return rows[0]?.display_name ?? "Facilitator";
}

/**
 * Record the human decision on a conflict cell (F15-T05, FR-39): promote the
 * chosen position into the cell's published `value` as ink, seed the cell's
 * provenance from the chosen position's answer — which respondent fed the cell
 * and from which question (F15-T06, FR-41: "decision-resolved cells carry
 * provenance too") — and attach the decision note. Both positions stay on the
 * cell, so they remain visible after the decision. Writes a NEW draft version
 * (a decision is a deliberate single action, never automatic). Throws
 * `NoOfficialConflictError` when the cell has no conflict,
 * `UnknownConflictPositionError` when the choice is not one of the positions,
 * and refuses a second decision once one is already recorded.
 */
export async function recordOfficialCellDecision(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  cellId: OpspCellId,
  positionId: string,
): Promise<{ version: number; cells: Record<OpspCellId, OfficialCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[cellId];
    if (!target) throw new OfficialDraftNotFoundError();
    const conflict = target.conflict;
    if (!conflict) throw new NoOfficialConflictError();
    if (conflict.decision) {
      // A decision is already recorded — there is nothing left to choose.
      throw new NoOfficialConflictError();
    }
    const chosen = conflict.positions.find((position) => position.id === positionId);
    if (!chosen) throw new UnknownConflictPositionError();

    const decision: OfficialCellDecision = {
      positionId: chosen.id,
      chosenText: chosen.text,
      recorderId: facilitatorId,
      recorderName: await respondentDisplayName(tx, facilitatorId),
      recordedAt: new Date().toISOString(),
    };

    const resolved: OfficialCell = {
      ...target,
      value: chosen.text,
      marking: { type: "single", mark: "ink" },
      sources: [chosen.questionId] as QuestionId[],
      lowConfidence: false,
      conflict: { ...conflict, decision },
      provenance: [
        {
          respondentId: chosen.respondentId,
          respondentName: chosen.respondentName,
          questionId: chosen.questionId,
        },
      ],
    };

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [cellId]: resolved,
    };

    const version = await writeOfficialCellsVersion(tx, cohortId, updated);
    return { version, cells: updated };
  });
}

/** True for a Postgres unique_violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
  );
}