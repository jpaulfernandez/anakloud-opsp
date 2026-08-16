import { describe, expect, it } from "vitest";

import {
  ANALYSIS_REQUEST_OUTPUT_CAP,
  DEFAULT_COHORT_INPUT_CAP,
  DEFAULT_COHORT_OUTPUT_CAP,
  PER_RESPONDENT_COACH_CALL_CEILING,
  coachCallsAllowed,
  isBudgetExhausted,
  perRequestOutputCap,
} from "../../lib/budget";

// F12-T04 — budget accounting, pure half (tech_infrastructure.md §6.4,
// spec.md §7.2). These are the countable rules — the per-purpose output cap,
// the budget-exhaustion predicate and the per-respondent ceiling — kept free
// of I/O so they are exhaustively testable the same way the validators are.
// The database half (the atomic interaction-row + counter transaction, the
// at-100% circuit open, and the cohort-creation budget row) is in
// budget.integration.test.ts.

describe("per-request output caps (§6.4)", () => {
  it("caps a coach call at 200 tokens and an analysis call at 1500", () => {
    expect(perRequestOutputCap("coach")).toBe(200);
    expect(perRequestOutputCap("analysis")).toBe(ANALYSIS_REQUEST_OUTPUT_CAP);
    expect(ANALYSIS_REQUEST_OUTPUT_CAP).toBe(1500);
  });

  it("treats synthesis like analysis (a generator, not a coach)", () => {
    expect(perRequestOutputCap("synthesis")).toBe(ANALYSIS_REQUEST_OUTPUT_CAP);
  });
});

describe("budget exhaustion (spec.md §7.2: credits exhausted)", () => {
  const base = { inputCap: 1000, inputUsed: 0, outputCap: 2000, outputUsed: 0 };

  it("is not exhausted below the caps", () => {
    expect(
      isBudgetExhausted({ ...base, inputUsed: 999, outputUsed: 1999 }),
    ).toBe(false);
  });

  it("is exhausted at 100% and beyond, on either direction", () => {
    expect(isBudgetExhausted({ ...base, inputUsed: 1000 })).toBe(true);
    expect(isBudgetExhausted({ ...base, inputUsed: 1200 })).toBe(true);
    expect(isBudgetExhausted({ ...base, outputUsed: 2000 })).toBe(true);
    expect(isBudgetExhausted({ ...base, outputUsed: 2250 })).toBe(true);
  });

  it("a fresh cohort with caps present is not exhausted by default", () => {
    expect(
      isBudgetExhausted({
        inputCap: DEFAULT_COHORT_INPUT_CAP,
        inputUsed: 0,
        outputCap: DEFAULT_COHORT_OUTPUT_CAP,
        outputUsed: 0,
      }),
    ).toBe(false);
  });
});

describe("per-respondent coach call ceiling (§6.4: default 40)", () => {
  it("allows calls up to but not past the ceiling", () => {
    expect(PER_RESPONDENT_COACH_CALL_CEILING).toBe(40);
    expect(coachCallsAllowed(0)).toBe(true);
    expect(coachCallsAllowed(39)).toBe(true);
    expect(coachCallsAllowed(40)).toBe(false);
    expect(coachCallsAllowed(400)).toBe(false);
  });

  it("the ceiling sits well above 3 nudges on the 8 coachable questions", () => {
    // §6.4's own scale check: 3 × 8 = 24, far below 40, so normal use never
    // trips it — it only catches abuse or a retry loop.
    expect(PER_RESPONDENT_COACH_CALL_CEILING).toBeGreaterThan(24);
  });
});