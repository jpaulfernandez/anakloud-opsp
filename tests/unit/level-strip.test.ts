import { describe, expect, it } from "vitest";
import type { BudgetSnapshot, ResolvedLevel } from "../../lib/level-strip";
import {
  budgetPercent,
  budgetState,
  budgetTotal,
  budgetWarningLabel,
  levelReason,
} from "../../lib/level-strip";

// F09-T04 — the pure level/strip derivation, asserted without a database,
// the same pattern as roster.test.ts. The three acceptances are pinned here at
// the rule level: the P1 strip shows L2 with an honest reason, the budget
// warnings appear at the 70% and 90% thresholds, and the strip only ever
// speaks of level/budget/circuit for a facilitator (nothing here renders for a
// respondent). The SQL that feeds the budget/circuit/guard data lives in the
// DB-gated integration test (level-strip.integration.test.ts) and the rendered
// strip in tests/e2e/level-strip.spec.ts.

function budget(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    inputCap: 1000,
    inputUsed: 100,
    outputCap: 2000,
    outputUsed: 200,
    circuitOpen: false,
    circuitReason: null,
    ...overrides,
  };
}

describe("F09-T04 — levelReason", () => {
  it("is null for levels the spec does not require a reason for", () => {
    for (const level of ["L0", "L3", "auto"] as ResolvedLevel[]) {
      expect(levelReason(level, null)).toBeNull();
      expect(levelReason(level, 50)).toBeNull();
    }
  });

  it("gives L1 a plain-language degradation reason", () => {
    expect(levelReason("L1", null)).toBe(
      "Running on rule-based checks while the AI is slow or unavailable.",
    );
  });

  it("gives L2 an honest rule-based reason when there is no budget data yet", () => {
    // The P1 shell must not fabricate a spend figure.
    expect(levelReason("L2", null)).toBe("Running on rule-based checks.");
  });

  it("echoes the budget share in the L2 reason when one exists (§7.2)", () => {
    expect(levelReason("L2", 94)).toBe(
      "Running on rule-based checks — AI budget at 94%.",
    );
    expect(levelReason("L2", 75)).toBe(
      "Running on rule-based checks — AI budget at 75%.",
    );
  });
});

describe("F09-T04 — budgetPercent", () => {
  it("is the whole-percentage share of the cap, floored", () => {
    expect(budgetPercent(150, 300)).toBe(50);
    expect(budgetPercent(1, 3)).toBe(33);
    expect(budgetPercent(0, 100)).toBe(0);
    expect(budgetPercent(100, 100)).toBe(100);
  });

  it("is null when there is no cap to measure against", () => {
    expect(budgetPercent(10, 0)).toBeNull();
    expect(budgetPercent(10, -1)).toBeNull();
  });
});

describe("F09-T04 — budgetState warning thresholds (§7.2)", () => {
  it("is ok below 70%", () => {
    expect(budgetState(0)).toBe("ok");
    expect(budgetState(50)).toBe("ok");
    expect(budgetState(69)).toBe("ok");
  });

  it("warns at and above 70%", () => {
    expect(budgetState(70)).toBe("warn70");
    expect(budgetState(75)).toBe("warn70");
    expect(budgetState(89)).toBe("warn70");
  });

  it("warns again at and above 90%", () => {
    expect(budgetState(90)).toBe("warn90");
    expect(budgetState(95)).toBe("warn90");
    expect(budgetState(100)).toBe("warn90");
  });
});

describe("F09-T04 — budgetWarningLabel", () => {
  it("has visible words at each warning threshold and silence when ok", () => {
    expect(budgetWarningLabel("ok")).toBeNull();
    expect(budgetWarningLabel("warn70")).toMatch(/70%/);
    expect(budgetWarningLabel("warn90")).toMatch(/90%/);
  });
});

describe("F09-T04 — budgetTotal combines input and output", () => {
  it("sums both token directions into one used/cap pair", () => {
    expect(budgetTotal(budget())).toEqual({ used: 300, cap: 3000 });
    expect(budgetTotal(budget({ inputUsed: 75, outputUsed: 75 }))).toEqual({
      used: 150,
      cap: 3000,
    });
  });
});