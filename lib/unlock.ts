import type { ClientBase } from "./db";

// Facilitator unlock with audit (F06-T05, FR-14, tech_infrastructure.md §3).
//
// The unlock is the deliberate loophole PR5 leaves for a real facilitator: a
// submitted respondent's answers are immutable, but a human occasionally needs
// to reopen one. It exists, it is gated to the facilitator (the route layer
// checks session.isFacilitator live), and it is logged via
// respondents.unlocked_by / unlocked_at — an unlock is exactly the kind of
// event the facilitator needs to be able to see on the dashboard.
//
// What it must never do is touch the baseline. `answer_snapshots` holds the
// frozen record of what was submitted, and no statement here references it:
// clearing the lock reopens the respondent for editing, and a later re-submit
// writes an ADDITIONAL snapshot through the normal submit transaction
// (performSubmit always inserts a fresh row) rather than replacing the
// original. That is what keeps an unlock from quietly rewriting history.

/** The target respondent is not in the caller's cohort, or does not exist. */
export class RespondentNotInCohortError extends Error {
  constructor() {
    super("respondent is not in the facilitator's cohort");
    this.name = "RespondentNotInCohortError";
  }
}

export interface UnlockResult {
  /** True when the target was submitted and has now been reopened; false when it was already unsubmitted. */
  unlocked: boolean;
}

/**
 * Reopen a submitted respondent. The actor must be the facilitator of the same
 * cohort: the route already verified session.isFacilitator live, and this
 * re-checks that the target belongs to the actor's cohort in SQL — respondents
 * is not RLS-gated, so a facilitator must not be able to unlock across cohorts.
 * Sets submitted_at to null and stamps unlocked_by/unlocked_at as the audit. A
 * target that is already unsubmitted is a no-op (unlocked: false) rather than
 * re-stamping the audit with a meaningless event.
 */
export async function performUnlock(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  targetRespondentId: string,
): Promise<UnlockResult> {
  const { rows } = await db.query(
    "select cohort_id, submitted_at from respondents where id = $1",
    [targetRespondentId],
  );
  const row = rows[0];
  if (!row || row.cohort_id !== cohortId) {
    throw new RespondentNotInCohortError();
  }
  if (row.submitted_at === null || row.submitted_at === undefined) {
    return { unlocked: false };
  }
  await db.query(
    `update respondents
        set submitted_at = null,
            unlocked_by = $2,
            unlocked_at = now()
      where id = $1`,
    [targetRespondentId, actorRespondentId],
  );
  return { unlocked: true };
}