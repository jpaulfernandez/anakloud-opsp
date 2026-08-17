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

/** A cohort's latest official OPSP draft row. */
export interface OfficialDraft {
  id: string;
  version: number;
  cells: Record<OpspCellId, OpspCell>;
}

/**
 * The blank opening canvas for the official OPSP: all sixteen cells present,
 * each an empty pencil cell so the grid matches the individual OPSP's structure
 * with nothing pre-filled (ui_ux.md §4.20 "nothing invented to fill a hole" —
 * the collaborative plan is authored, not auto-derived).
 */
export function emptyOfficialCells(): Record<OpspCellId, OpspCell> {
  const cells = {} as Record<OpspCellId, OpspCell>;
  for (const id of OPSP_CELL_IDS) {
    cells[id] = {
      value: null,
      marking: { type: "single", mark: "pencil" },
      sources: [],
      lowConfidence: false,
    };
  }
  return cells;
}

/** The cohort's latest official draft, or null when no official draft exists. */
async function latestOfficialDraft(
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
    cells: row.cells as Record<OpspCellId, OpspCell>,
  };
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
 * table is never touched (PR5). Returns the new version and its cells.
 */
export async function createOfficialDraftVersion(
  db: ClientBase,
  facilitatorId: string,
  cohortId: string,
  edit: { cellId: OpspCellId; content?: string | null; mark?: "ink" | "pencil" },
): Promise<{ version: number; cells: Record<OpspCellId, OpspCell> }> {
  return withRespondentContext(db, facilitatorId, async (tx) => {
    const current = await latestOfficialDraft(tx, cohortId);
    if (!current) throw new OfficialDraftNotFoundError();
    const target = current.cells[edit.cellId];
    if (!target) throw new OfficialDraftNotFoundError();

    const { rows } = await tx.query<{ next: number }>(
      `select coalesce(max(version), 0) + 1 as next
         from opsp_drafts
        where owner_type = 'official' and cohort_id = $1`,
      [cohortId],
    );
    const next = rows[0].next;

    const updated: Record<OpspCellId, OpspCell> = {
      ...current.cells,
      [edit.cellId]: applyCellEdit(target, edit),
    };

    await tx.query(
      `insert into opsp_drafts
         (id, cohort_id, owner_type, owner_id, version, cells)
       values ($1, $2, 'official', null, $3, $4::jsonb)`,
      [randomUUID(), cohortId, next, JSON.stringify(updated)],
    );

    return { version: next, cells: updated };
  });
}

/** True for a Postgres unique_violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { code?: string }).code === "23505"
  );
}