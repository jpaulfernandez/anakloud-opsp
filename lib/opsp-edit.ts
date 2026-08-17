import { randomUUID } from "node:crypto";
import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import {
  OPSP_CELL_IDS,
  type OpspCell,
  type OpspCellId,
  type OpspMark,
} from "./opsp";
import { latestIndividualDraftCells } from "./opsp-draft";

// OPSP editing and versioning (F07-T05, FR-26, PR5, ui_ux.md §4.15). The
// respondent can rewrite their own OPSP cells inline and manually toggle each
// cell's ink/pencil mark. Every edit writes a NEW opsp_drafts version and never
// modifies a prior one, and — the non-negotiable — editing an OPSP cell SHALL
// NOT modify any answers row. The only DB write in this module is a single
// `insert into opsp_drafts`; the answers table is unreachable from here, which
// is the structural form of PR5 (original answers stay as they were submitted).
//
// An edited cell keeps the OpspCell shape but stores plain text in `value`
// (the respondent's own rewrite) instead of the structured fragment map the
// deterministic mapping derives — lib/opsp-view's formatOpspCellValue renders a
// string verbatim, so a rewritten cell reads back exactly as typed. Clearing
// the text sets `value` to null, which the F07-T03 treatment renders as a real
// blank (never auto-filled). Sources/provenance and lowConfidence are kept as
// they were, so provenance survives an edit.

/** Thrown by createOpspDraftVersion when the respondent has no draft to edit. */
export class OpspDraftNotFoundError extends Error {
  constructor() {
    super("no individual OPSP draft to edit");
    this.name = "OpspDraftNotFoundError";
  }
}

/**
 * A validated single-cell edit. `cellId` is always present; `content` and
 * `mark` are present only when the caller asked to change them, so an edit
 * that only toggles the mark leaves the text untouched and vice versa.
 */
export interface ParsedOpspEdit {
  cellId: OpspCellId;
  /** The rewritten text, or null to clear the cell. Absent = leave unchanged. */
  content?: string | null;
  /** The mark to force the whole cell to. Absent = leave unchanged. */
  mark?: OpspMark;
}

/**
 * Validate and normalise an edit body. Accepts `{ cellId, content?, mark? }`.
 * `content` must be a string or null; an empty string is allowed (the caller
 * clearing the cell — applyCellEdit turns it into a null value). `mark` must be
 * "ink" or "pencil". At least one of content/mark must be present. Returns null
 * for any malformed or no-op body.
 */
export function parseOpspEdit(body: unknown): ParsedOpspEdit | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.cellId !== "string") return null;
  if (!(OPSP_CELL_IDS as readonly string[]).includes(b.cellId)) return null;

  const edit: ParsedOpspEdit = { cellId: b.cellId as OpspCellId };
  if ("content" in b) {
    if (b.content !== null && typeof b.content !== "string") return null;
    edit.content = b.content === null ? null : b.content;
  }
  if ("mark" in b) {
    if (b.mark !== "ink" && b.mark !== "pencil") return null;
    edit.mark = b.mark;
  }
  if (edit.content === undefined && edit.mark === undefined) return null;
  return edit;
}

/**
 * Apply an edit to one cell, returning a new cell and never mutating the
 * input. Sources and lowConfidence are carried over unchanged; content and mark
 * are replaced only when the edit asks for them.
 */
export function applyCellEdit(cell: OpspCell, edit: ParsedOpspEdit): OpspCell {
  const next: OpspCell = {
    value: cell.value,
    marking: cell.marking,
    sources: [...cell.sources],
    lowConfidence: cell.lowConfidence,
  };
  if (edit.content !== undefined) {
    // An empty string means the respondent cleared the cell: it becomes a real
    // blank (null), rendered and treated exactly like an unanswered cell.
    next.value = edit.content === "" ? null : edit.content;
  }
  if (edit.mark !== undefined) {
    // A manual toggle is a whole-cell mark; the split marking on 3-Year
    // Targets gives way to the respondent's explicit choice.
    next.marking = { type: "single", mark: edit.mark };
  }
  return next;
}

/**
 * Edit the respondent's own latest individual OPSP draft: create one new
 * version based on the current (highest-version) cells with the edit applied,
 * leaving every prior version untouched. Runs inside the respondent's RLS
 * context (F01-T04) so it can only ever read and write their own draft. The
 * new version number is the current maximum plus one. Returns the new version
 * and its cells. Throws `OpspDraftNotFoundError` when the respondent has no
 * draft (unsubmitted, or a fixture that skipped submit).
 *
 * The single write is `insert into opsp_drafts` — nothing touches `answers`.
 */
export async function createOpspDraftVersion(
  db: ClientBase,
  respondentId: string,
  cohortId: string,
  edit: ParsedOpspEdit,
): Promise<{ version: number; cells: Record<OpspCellId, OpspCell> }> {
  return withRespondentContext(db, respondentId, async (tx) => {
    const current = await latestIndividualDraftCells(tx);
    // latestIndividualDraftCells reads inside this transaction's RLS context,
    // so it can only see the respondent's own draft.
    if (!current) throw new OpspDraftNotFoundError();
    const target = current[edit.cellId];
    if (!target) throw new OpspDraftNotFoundError();

    const { rows } = await tx.query<{ next: number }>(
      `select coalesce(max(version), 0) + 1 as next
         from opsp_drafts
        where owner_type = 'individual' and owner_id = app_current_respondent()`,
    );
    const next = rows[0].next;

    const updated: Record<OpspCellId, OpspCell> = {
      ...current,
      [edit.cellId]: applyCellEdit(target, edit),
    };

    // A new row, never an update — the previous version is the baseline of
    // record and must survive (FR-26, "edits create a new version").
    await tx.query(
      `insert into opsp_drafts
         (id, cohort_id, owner_type, owner_id, version, cells)
       values ($1, $2, 'individual', $3, $4, $5::jsonb)`,
      [randomUUID(), cohortId, respondentId, next, JSON.stringify(updated)],
    );

    return { version: next, cells: updated };
  });
}