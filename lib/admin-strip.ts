import type { ClientBase } from "pg";
import type { BudgetSnapshot } from "./level-strip";
import {
  advanceBudgetAlerts,
  budgetPercent,
  budgetTotal,
  type BudgetAlert,
  type BudgetAlertState,
} from "./level-strip";

// F09-T04 — the admin strip's data source (tech_infrastructure.md §11).
//
// ai_budget and ai_interactions carry no row-level security (F01-T04 gates
// only answers, answer_snapshots and opsp_drafts), so these are plain queries
// run as the app's own role. The guard-trip count joins ai_interactions to
// respondents so it scopes to the facilitator's cohort. Everything here is the
// same data the facilitator already sees on the dashboard, so nothing new is
// exposed to anyone who could not already read the cohort's roster.

/**
 * The cohort's token-budget row, or null when none exists yet. Most P1 cohorts
 * have no row — F12 creates and updates it — so the strip shows honest dashes
 * rather than a fabricated spend.
 */
export async function fetchBudget(
  db: ClientBase,
  cohortId: string,
): Promise<BudgetSnapshot | null> {
  const { rows } = await db.query(
    `select input_cap, input_used, output_cap, output_used,
            circuit_open, circuit_reason,
            warn70_fired, warn90_fired
       from ai_budget
      where cohort_id = $1`,
    [cohortId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    inputCap: r.input_cap,
    inputUsed: r.input_used,
    outputCap: r.output_cap,
    outputUsed: r.output_used,
    circuitOpen: r.circuit_open,
    circuitReason: r.circuit_reason,
    warn70Fired: r.warn70_fired,
    warn90Fired: r.warn90_fired,
  };
}

/**
 * Advance the cohort's budget-warning state against its current spend and
 * persist the result, returning which thresholds newly fired on this request.
 * F12-T07's "once each, not on every request": a threshold already fired in a
 * previous request does not fire again, so reloading the dashboard at the same
 * spend re-warns nothing. The fired flags are written back to `ai_budget` only
 * when they changed, so an idle dashboard never writes.
 */
export async function advanceAndPersistBudgetAlerts(
  db: ClientBase,
  cohortId: string,
  budget: BudgetSnapshot,
): Promise<BudgetAlert[]> {
  const total = budgetTotal(budget);
  const percent = budgetPercent(total.used, total.cap);
  if (percent === null) return [];

  const { fired, state } = advanceBudgetAlerts(percent, {
    warn70Fired: budget.warn70Fired,
    warn90Fired: budget.warn90Fired,
  });
  if (fired.length > 0) {
    await persistBudgetAlertState(db, cohortId, state);
  }
  return fired;
}

/** Persist the cohort's fired-warning flags back to its `ai_budget` row. */
export async function persistBudgetAlertState(
  db: ClientBase,
  cohortId: string,
  state: BudgetAlertState,
): Promise<void> {
  await db.query(
    `update ai_budget
        set warn70_fired = $2, warn90_fired = $3
      where cohort_id = $1`,
    [cohortId, state.warn70Fired, state.warn90Fired],
  );
}

/**
 * How many coach responses the cohort's output guard has rejected — rows in
 * ai_interactions with a non-null guard_tripped. Guard trips are the metric
 * that matters (tech_infrastructure §11): a rising count is the signal the
 * prompt is leaking domain content into hints and quietly contaminating the
 * baseline.
 */
export async function fetchGuardTrips(
  db: ClientBase,
  cohortId: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as trips
       from ai_interactions i
       join respondents r on r.id = i.respondent_id
      where r.cohort_id = $1
        and i.guard_tripped is not null`,
    [cohortId],
  );
  return rows[0].trips;
}