import { randomUUID } from "node:crypto";
import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import { listOwnAnswers, type OwnAnswerRow } from "./answers";
import { buildOpspCells, type OpspSourceAnswers } from "./opsp";

// Submit, snapshot and OPSP generation (F06-T03, FR-14, FR-22,
// tech_infrastructure.md §3, §4). POST /api/submit does, in one transaction:
// stamp `respondents.submitted_at`, freeze every answer into an
// `answer_snapshots` row, and create the respondent's individual OPSP draft at
// version 1. If any statement fails the whole thing rolls back and the
// respondent stays unsubmitted — a partial baseline is worse than none.
//
// The snapshot payload is keyed by question_id and tagged per entry with
// `is_private`, so q14d rides inside the frozen record (FR-14's "answer
// snapshots hold a frozen payload") while the private-exclusion rule survives
// the freeze: downstream consumers read through publicSnapshotEntries and the
// note drops out at the payload level, never in a template. This is the same
// guarantee the live answers table already holds via listPublicAnswers —
// carried here so a snapshot is as safe to send to an export as the live row
// was.
//
// Everything happens inside withRespondentContext because `answer_snapshots`
// and `opsp_drafts` are RLS-gated on the current respondent (F01-T04); the
// policies resolve who is acting from `app.respondent_id`, so the inserts must
// run as the submitting respondent.

/** One frozen answer inside an answer_snapshots payload. */
export interface SnapshotEntry {
  value: unknown;
  confidence: number | null;
  /** Mirrors `answers.is_private`: true for q14d, the private note. */
  is_private: boolean;
}

/** The full frozen payload: every answer row, keyed by question_id. */
export type SnapshotPayload = Record<string, SnapshotEntry>;

/**
 * An individual OPSP draft's `cells` map at submit time. The deterministic
 * mapping of answers into cells is F07-T01 (lib/opsp.ts); F06-T03 ships the
 * draft scaffold at version 1, and the default builder below populates it with
 * the respondent's real cells.
 */
export type OpspCells = Record<string, unknown>;

/**
 * The deterministic answer→OPSP-cell mapping. F07-T01's buildOpspCells is the
 * default; the argument is the frozen snapshot payload so the mapping can
 * derive each cell only from the answers of the respondent who owns it.
 */
export type OpspCellsBuilder = (payload: OpspSourceAnswers) => OpspCells;

export interface SubmitResult {
  /** True when the respondent was already submitted; no rows were touched. */
  alreadySubmitted: boolean;
  snapshotId?: string;
  draftId?: string;
  submittedAt?: Date;
}

/**
 * Freeze the respondent's own answer rows into a snapshot payload. `rows` come
 * from listOwnAnswers, the one read that includes the owner's own q14d, so the
 * frozen record is complete — every answer, including the private note — and
 * each entry carries its private flag for downstream exclusion.
 */
export function buildSnapshotPayload(rows: readonly OwnAnswerRow[]): SnapshotPayload {
  const payload: SnapshotPayload = {};
  for (const row of rows) {
    payload[row.question_id] = {
      value: row.value,
      confidence: row.confidence,
      is_private: row.is_private,
    };
  }
  return payload;
}

/**
 * The non-private view of a snapshot, preserving the payload's answer order.
 * Every consumer of a frozen payload (OPSP mapping, exports, PDF) reads through
 * here; exclusion is a property of the payload tag, not a filter someone must
 * remember.
 */
export function publicSnapshotEntries(
  payload: SnapshotPayload,
): Array<[string, SnapshotEntry]> {
  return Object.entries(payload).filter(([, entry]) => !entry.is_private);
}

const OPSP_VERSION = 1;

/**
 * Perform the submit transaction. Idempotent by construction: if the
 * respondent is already submitted the transaction returns `alreadySubmitted`
 * without writing a snapshot or draft, so a second submit re-returns the
 * existing state rather than duplicating rows (F06-T03 acceptance).
 */
export async function performSubmit(
  db: ClientBase,
  respondentId: string,
  cohortId: string,
  buildOPSPCells: OpspCellsBuilder = buildOpspCells,
): Promise<SubmitResult> {
  return withRespondentContext(db, respondentId, async (tx) => {
    const existing = await tx.query(
      "select submitted_at from respondents where id = $1",
      [respondentId],
    );
    const row = existing.rows[0];
    if (row && row.submitted_at !== null && row.submitted_at !== undefined) {
      return { alreadySubmitted: true };
    }

    const rows = await listOwnAnswers(tx);
    const payload = buildSnapshotPayload(rows);

    const submittedAt = new Date();
    await tx.query("update respondents set submitted_at = $1 where id = $2", [
      submittedAt,
      respondentId,
    ]);

    const snapshotId = randomUUID();
    await tx.query(
      "insert into answer_snapshots (id, respondent_id, payload) values ($1, $2, $3::jsonb)",
      [snapshotId, respondentId, JSON.stringify(payload)],
    );

    const draftId = randomUUID();
    await tx.query(
      `insert into opsp_drafts
         (id, cohort_id, owner_type, owner_id, version, cells)
       values ($1, $2, 'individual', $3, $4, $5::jsonb)`,
      [draftId, cohortId, respondentId, OPSP_VERSION, JSON.stringify(buildOPSPCells(payload))],
    );

    return { alreadySubmitted: false, snapshotId, draftId, submittedAt };
  });
}