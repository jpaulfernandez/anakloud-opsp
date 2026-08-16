// The admin header strip (F09-T04, spec.md §7/§7.2, ui_ux §4.17,
// tech_infrastructure §11). Pure derivation, kept free of I/O and the DB the
// same way lib/roster.ts and lib/validators.ts are: the level/reason and
// budget-warning rules are asserted exhaustively in unit tests, and only the
// SQL fetch (lib/admin-strip.ts) needs a database.
//
// Client-safe by construction — only the `ResolvedLevel` type is imported from
// config.ts, which is erased at build, so a component that renders this never
// drags the server config graph into a client bundle.

import type { ResolvedLevel } from "./config";

export type { ResolvedLevel } from "./config";

/** The `ai_budget` row, surfaced on the strip as F12 will populate it. */
export interface BudgetSnapshot {
  inputCap: number;
  inputUsed: number;
  outputCap: number;
  outputUsed: number;
  circuitOpen: boolean;
  circuitReason: string | null;
}

/** Everything the header strip renders, assembled server-side. */
export interface AdminStripData {
  /** The deterministic boot level (config.ts); F12 resolves `auto`. */
  level: ResolvedLevel;
  /** The cohort's budget row, absent pre-F12 (no row exists yet). */
  budget: BudgetSnapshot | null;
  /** Coach rows whose output guard rejected the model output (§11). */
  guardTrips: number;
}

/** Total tokens used against total cap, input and output combined. */
export function budgetTotal(budget: BudgetSnapshot): {
  used: number;
  cap: number;
} {
  return {
    used: budget.inputUsed + budget.outputUsed,
    cap: budget.inputCap + budget.outputCap,
  };
}

/**
 * The cohort's spend as a whole percentage (0..100), floored. Null when there
 * is no cap to measure against, so a pre-budget cohort never gets a fabricated
 * figure.
 */
export function budgetPercent(used: number, cap: number): number | null {
  if (cap <= 0) return null;
  return Math.floor((used / cap) * 100);
}

/** The warning band, per spec.md §7.2: nothing, then 70%, then 90%. */
export type BudgetState = "ok" | "warn70" | "warn90";

export function budgetState(percent: number): BudgetState {
  if (percent >= 90) return "warn90";
  if (percent >= 70) return "warn70";
  return "ok";
}

/** The facilitator-facing warning words for a band; null when the spend is OK. */
export function budgetWarningLabel(state: BudgetState): string | null {
  switch (state) {
    case "warn70":
      return "AI budget above 70% — watch usage.";
    case "warn90":
      return "AI budget above 90% — nearly exhausted.";
    default:
      return null;
  }
}

/**
 * The plain-language reason, present only where spec.md §7 requires it — L1
 * and L2. Other levels carry no reason. The L2 reason echoes the budget share
 * when one exists (the §7.2 example "AI budget at 94%."), and stays a plain
 * rule-based statement when the cohort has no spend data yet — so the P1
 * shell is honest rather than inventing a figure.
 */
export function levelReason(
  level: ResolvedLevel,
  percent: number | null,
): string | null {
  switch (level) {
    case "L1":
      return "Running on rule-based checks while the AI is slow or unavailable.";
    case "L2":
      return percent === null
        ? "Running on rule-based checks."
        : `Running on rule-based checks — AI budget at ${percent}%.`;
    default:
      return null;
  }
}