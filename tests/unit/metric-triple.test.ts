import { describe, expect, it } from "vitest";
import {
  metricTripleIsAnswered,
  parseMetricValue,
  toMetricTripleValue,
} from "../../lib/metric-triple";

// Pure metric-triple helpers (F03-T04, ui_ux.md §4.6, tech_infrastructure.md
// §3.1). The number normalisation and the "is this question answered" rule are
// deterministic behaviour the shell's forward-navigation depends on, so they
// are verified without a browser — and the "1,500 stores as 1500" acceptance
// lives here, in the normalisation function.

describe("parseMetricValue", () => {
  it("accepts digits with thousands separators and stores a normalised number", () => {
    // The exact acceptance: "1,500 entered in the number field stores as 1500".
    expect(parseMetricValue("1,500")).toBe(1500);
  });

  it("accepts a plain number without separators", () => {
    expect(parseMetricValue("300")).toBe(300);
  });

  it("normalises larger thousands-separated values", () => {
    expect(parseMetricValue("1,000,000")).toBe(1000000);
    expect(parseMetricValue("2,500.5")).toBe(2500.5);
  });

  it("treats an empty number field as having no value, not the number 0", () => {
    // An unanswered number field must not masquerade as 0.
    expect(parseMetricValue("")).toBeNull();
    expect(parseMetricValue("   ")).toBeNull();
  });

  it("treats text that is not a number as having no value", () => {
    expect(parseMetricValue("children")).toBeNull();
    expect(parseMetricValue("1,5OO")).toBeNull(); // letter O, not a digit
  });
});

describe("metricTripleIsAnswered", () => {
  it("requires all four parts: metric, a parseable number, unit, and why", () => {
    expect(
      metricTripleIsAnswered({
        metric: "Children with an active therapy plan",
        value: 10000,
        unit: "children",
        why: "that's the only number that means we changed something",
      }),
    ).toBe(true);
  });

  it("is unanswered while the number field holds no value", () => {
    expect(
      metricTripleIsAnswered({
        metric: "Paying therapy centers",
        value: null,
        unit: "centers",
        why: "centers are the distribution",
      }),
    ).toBe(false);
  });

  it("is unanswered while any one part is missing or blank", () => {
    const base = {
      metric: "Monthly recurring revenue",
      value: 2000000,
      unit: "pesos",
      why: "if we can't get here we're a school project",
    };
    expect(metricTripleIsAnswered({ ...base, metric: "" })).toBe(false);
    expect(metricTripleIsAnswered({ ...base, unit: "   " })).toBe(false);
    expect(metricTripleIsAnswered({ ...base, why: "" })).toBe(false);
  });
});

describe("toMetricTripleValue", () => {
  it("maps a filled draft onto the §3.1 stored shape", () => {
    // The answer persists as `{ metric, value, unit, why }` (F03-T04).
    const stored = toMetricTripleValue({
      metric: "Paying therapy centers",
      value: 300,
      unit: "centers",
      why: "everything else follows from this",
    });
    expect(stored).toEqual({
      metric: "Paying therapy centers",
      value: 300,
      unit: "centers",
      why: "everything else follows from this",
    });
  });
});