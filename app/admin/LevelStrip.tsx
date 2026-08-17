import type { AdminStripData } from "@/lib/level-strip";
import {
  budgetAlertLabel,
  budgetPercent,
  budgetTotal,
  levelReason,
} from "@/lib/level-strip";

// F09-T04 — the level & budget header strip (spec.md §7/§7.2, ui_ux §4.17,
// tech_infrastructure §11). The facilitator's one-line read of the AI's
// health: the current degradation level and, at L1/L2, an honest plain-language
// reason; plus the cohort's spend against its token cap, circuit state and
// guard-trip count. It renders on the admin dashboard alone — never on any
// respondent-facing view (PR6: degradation looks intentional, and only to the
// facilitator).
//
// The level is the deterministic boot pin (lib/config.ts); live budget, circuit
// and guard data are F12's. The strip is built now so the shell is honest at
// L2 — "Running on rule-based checks." with no fabricated figure — and the
// F12 slots render as obvious "—" dashes until rows exist.
//
// F12-T07 — the budget-warning callouts render only for thresholds that
// *newly fired on this request* (data.budgetAlerts), so a reload at the same
// spend re-warns nothing. The guard-trip alert appears whenever the cohort has
// 3+ trips (§11); unlike a threshold crossing, contamination is a standing
// condition and stays visible until the facilitator acts on it.

export default function LevelStrip({ data }: { data: AdminStripData }) {
  const total = data.budget ? budgetTotal(data.budget) : null;
  const percent = total === null ? null : budgetPercent(total.used, total.cap);
  const reason = levelReason(data.level, percent);
  const circuitLabel =
    data.budget === null ? "—" : data.budget.circuitOpen ? "Open" : "Closed";

  return (
    <div
      data-testid="admin-level-strip"
      className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card text-sm text-neutral-700"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">
            Level
          </span>
          <span
            data-testid="strip-level"
            className="rounded-lg bg-cobalt-600 px-2.5 py-1 text-xs font-bold text-white shadow-cobalt"
          >
            {data.level === "auto" ? "Auto" : data.level}
          </span>
        </div>

        {reason !== null ? (
          <span data-testid="strip-reason" className="text-xs font-medium text-neutral-600 bg-neutral-100 px-2.5 py-1 rounded-lg">
            {reason}
          </span>
        ) : null}

        {data.budgetAlerts.map((alert) => (
          <span
            key={alert}
            data-testid="strip-warning"
            className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 border border-amber-200"
          >
            {budgetAlertLabel(alert)}
          </span>
        ))}

        {data.guardAlert !== null ? (
          <span
            data-testid="strip-guard-alert"
            className="rounded-lg bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-900 border border-rose-200"
          >
            {data.guardAlert}
          </span>
        ) : null}
      </div>

      <dl className="flex flex-wrap items-center gap-6 text-xs text-neutral-600">
        <div>
          <dt className="font-semibold uppercase tracking-wider text-neutral-400">
            Token budget
          </dt>
          <dd data-testid="strip-budget" className="font-bold tabular-nums text-neutral-900 mt-0.5">
            {total === null ? "—" : `${total.used} / ${total.cap}`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wider text-neutral-400">
            Circuit
          </dt>
          <dd data-testid="strip-circuit" className="font-bold tabular-nums text-neutral-900 mt-0.5">
            {circuitLabel}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wider text-neutral-400">
            Guard trips
          </dt>
          <dd data-testid="strip-guard-trips" className="font-bold tabular-nums text-neutral-900 mt-0.5">
            {data.guardTrips}
          </dd>
        </div>
      </dl>
    </div>
  );
}