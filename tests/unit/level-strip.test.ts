import { describe, expect, it } from "vitest";
import type { BudgetSnapshot, ResolvedLevel } from "../../lib/level-strip";
import {
  advanceBudgetAlerts,
  initialBudgetAlertState,
  budgetAlertLabel,
  budgetPercent,
  budgetState,
  budgetTotal,
  budgetWarningLabel,
  guardTripAlert,
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
//
// F12-T07 — the same file carries the budget-alert state machine: each
// threshold fires at most once per cohort, so reloading at the same spend
// re-warns nothing, and the guard-trip alert appears at 3+ trips.

function budget(overrides: Partial<BudgetSnapshot> = {}): BudgetSnapshot {
  return {
    inputCap: 1000,
    inputUsed: 100,
    outputCap: 2000,
    outputUsed: 200,
    circuitOpen: false,
    circuitReason: null,
    warn70Fired: false,
    warn90Fired: false,
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

describe("F12-T07 — advanceBudgetAlerts fires each threshold once", () => {
  it("fires the 70% warning on first crossing of the 70% band", () => {
    expect(advanceBudgetAlerts(75, initialBudgetAlertState)).toEqual({
      fired: ["warn70"],
      state: { warn70Fired: true, warn90Fired: false },
    });
  });

  it("does not re-fire the 70% warning on a later request in the same band", () => {
    const { state } = advanceBudgetAlerts(75, initialBudgetAlertState);
    // Reload at a higher-but-still-70% spend must warn nothing.
    expect(advanceBudgetAlerts(85, state)).toEqual({
      fired: [],
      state,
    });
  });

  it("fires the 90% warning once 90% is crossed, even after 70% already fired", () => {
    const at70 = advanceBudgetAlerts(75, initialBudgetAlertState);
    expect(advanceBudgetAlerts(95, at70.state)).toEqual({
      fired: ["warn90"],
      state: { warn70Fired: true, warn90Fired: true },
    });
  });

  it("does not re-fire either warning on repeated requests at 90%+", () => {
    const once = advanceBudgetAlerts(95, initialBudgetAlertState);
    expect(once.fired).toEqual(["warn90"]);
    expect(advanceBudgetAlerts(95, once.state)).toEqual({
      fired: [],
      state: once.state,
    });
    expect(advanceBudgetAlerts(100, once.state).fired).toEqual([]);
  });

  it("gives a cohort that jumps straight past 70% the stronger 90% warning, not two", () => {
    expect(advanceBudgetAlerts(95, initialBudgetAlertState)).toEqual({
      fired: ["warn90"],
      state: { warn70Fired: true, warn90Fired: true },
    });
  });

  it("never fires below the 70% threshold", () => {
    expect(advanceBudgetAlerts(69, initialBudgetAlertState)).toEqual({
      fired: [],
      state: initialBudgetAlertState,
    });
  });
});

describe("F12-T07 — budgetAlertLabel and guardTripAlert", () => {
  it("spells out each warning threshold in facilitator-facing words", () => {
    expect(budgetAlertLabel("warn70")).toMatch(/70%/);
    expect(budgetAlertLabel("warn90")).toMatch(/90%/);
    expect(budgetAlertLabel("warn90")).toMatch(/nearly exhausted/);
  });

  it("holds silent below the 3-trip guard threshold", () => {
    expect(guardTripAlert(0)).toBeNull();
    expect(guardTripAlert(2)).toBeNull();
  });

  it("alerts at the third guard trip (§11)", () => {
    expect(guardTripAlert(3)).not.toBeNull();
    expect(guardTripAlert(5)).toMatch(/3 or more/);
  });

  it("phrases the guard alert for a non-engineer", () => {
    // The acceptance: the reason string is readable by a non-engineer — no
    // bare codes, no symbol names. Guard trips ARE the metric, so the alert
    // names contamination as its consequence, not the schema column.
    const alert = guardTripAlert(3);
    expect(alert).not.toMatch(/guard_tripped|ai_interactions|GL[\d]+|\bL\d\b/);
    expect(alert).toMatch(/hints may be leaking guidance/);
  });
});

describe("F12-T07 — the served-level reason reads plainly", () => {
  it("names the degradation cause, not a code, wherever a reason is shown", () => {
    // L1/L2 are the only levels carrying a reason (spec.md §7).
    expect(levelReason("L1", null)).toMatch(/^[A-Z]/);
    expect(levelReason("L2", null)).not.toMatch(/\bL[0-2]\b/);
    expect(levelReason("L2", 94)).not.toMatch(/\bL[0-2]\b/);
  });
});