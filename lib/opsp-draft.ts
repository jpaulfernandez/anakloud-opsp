import type { ClientBase } from "pg";
import type { OpspCell, OpspCellId } from "./opsp";

// Reading a respondent's own individual OPSP draft (F07-T02, FR-22/23). The
// draft is created at submit (F06-T03) as an `opsp_drafts` row gated by the
// drafts_own_read policy on owner_type = 'individual' and owner_id =
// app_current_respondent() (F01-T04). Reading therefore must run inside the
// respondent's RLS context (withRespondentContext); this helper is the only
// read of the respondent's own draft, and it returns the highest version so
// the view always shows their latest plan. Later edits (F07-T05) write new
// versions, never mutate prior ones, so a read ordered by version descending
// is stable against that contract.

/** A respondent's own latest individual OPSP draft row. */
export interface IndividualDraft {
  id: string;
  version: number;
  cells: Record<OpspCellId, OpspCell>;
}

/**
 * The caller's latest individual OPSP draft, or null when none exists. A
 * submitted respondent always has version 1 (created by performSubmit), so a
 * null result only arises for a respondent who never went through submit —
 * which the /opsp route treats as a redirect, not an error. F07-T05 surfaces
 * the draft id so the edit route targets the draft the respondent is looking
 * at.
 */
export async function latestIndividualDraft(
  db: ClientBase,
): Promise<IndividualDraft | null> {
  const { rows } = await db.query<{ id: string; version: number; cells: unknown }>(
    `select id, version, cells
       from opsp_drafts
      where owner_type = 'individual' and owner_id = app_current_respondent()
      order by version desc
      limit 1`,
  );
  const row = rows[0];
  if (!row || row.cells === null || row.cells === undefined) return null;
  return { id: row.id, version: row.version, cells: row.cells as Record<OpspCellId, OpspCell> };
}

/**
 * The caller's latest individual OPSP draft cells, or null when none exists.
 * Convenience over latestIndividualDraft for callers that only need the cells.
 */
export async function latestIndividualDraftCells(
  db: ClientBase,
): Promise<Record<OpspCellId, OpspCell> | null> {
  const draft = await latestIndividualDraft(db);
  return draft ? draft.cells : null;
}