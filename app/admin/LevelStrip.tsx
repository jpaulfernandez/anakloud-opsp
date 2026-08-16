import type { AdminStripData } from "@/lib/level-strip";
import {
  budgetPercent,
  budgetState,
  budgetTotal,
  budgetWarningLabel,
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

export default function LevelStrip({ data }: { data: AdminStripData }) {
  const total = data.budget ? budgetTotal(data.budget) : null;
  const percent = total === null ? null : budgetPercent(total.used, total.cap);
  const warning =
    percent === null ? null : budgetWarningLabel(budgetState(percent));
  const reason = levelReason(data.level, percent);
  const circuitLabel =
    data.budget === null ? "—" : data.budget.circuitOpen ? "Open" : "Closed";

  return (
    <div
      data-testid="admin-level-strip"
      className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700"
    >
      <div className="flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-neutral-500">
          Level
        </span>
        <span
          data-testid="strip-level"
          className="rounded-md bg-neutral-900 px-2 py-0.5 font-semibold text-white"
        >
          {data.level === "auto" ? "Auto" : data.level}
        </span>
      </div>

      {reason !== null ? (
        <span data-testid="strip-reason" className="text-neutral-700">
          {reason}
        </span>
      ) : null}

      {warning !== null ? (
        <span
          data-testid="strip-warning"
          className="rounded-md bg-amber-50 px-2 py-0.5 font-medium text-amber-900"
        >
          {warning}
        </span>
      ) : null}

      <dl className="flex gap-5 text-xs text-neutral-600">
        <div>
          <dt className="uppercase tracking-wide text-neutral-500">
            Token budget
          </dt>
          <dd data-testid="strip-budget" className="tabular-nums">
            {total === null ? "—" : `${total.used} / ${total.cap}`}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-neutral-500">
            Circuit
          </dt>
          <dd data-testid="strip-circuit" className="tabular-nums">
            {circuitLabel}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-neutral-500">
            Guard trips
          </dt>
          <dd data-testid="strip-guard-trips" className="tabular-nums">
            {data.guardTrips}
          </dd>
        </div>
      </dl>
    </div>
  );
}