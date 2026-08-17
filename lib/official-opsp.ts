import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import { applyCellEdit } from "./opsp-edit";
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
 * An official OPSP cell: the same OpspCell shape as the individual plan plus
 * the source cards attached to it. The official canvas starts without any
 * published cell content but can carry cards under each cell as the
 * facilitator pulls answers in from the cohort.
 */
export interface OfficialCell extends OpspCell {
  sourceCards: OfficialSourceCard[];
}

/** Ensure an OpspCell (possibly a pre-F15-T02 row) carries a sourceCards array. */
function toOfficialCell(cell: OpspCell): OfficialCell {
  const sourceCards = Array.isArray((cell as Partial<OfficialCell>).sourceCards)
    ? (cell as OfficialCell).sourceCards
    : [];
  return { ...cell, sourceCards };
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
    };

    const updated: Record<OpspCellId, OfficialCell> = {
      ...current.cells,
      [edit.cellId]: edited,
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