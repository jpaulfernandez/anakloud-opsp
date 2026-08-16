import { describe, expect, it } from "vitest";
import { parseComparisonMode } from "../../lib/comparison";

// F10-T02 — the comparison endpoint's mode parsing. The whole safety posture
// hangs on this: anonymised must be the default and the failure-safe fallback,
// because the failure mode is projecting names onto a wall (ui_ux.md §4.18).
// Attributed names are served only for an exact, explicit request, never by a
// missing value, an empty one, or a misspelling.

describe("parseComparisonMode (F10-T02)", () => {
  it("defaults to anonymised when no mode is supplied", () => {
    expect(parseComparisonMode(undefined)).toBe("anonymised");
    expect(parseComparisonMode(null)).toBe("anonymised");
  });

  it("treats only the exact string 'attributed' as attributed", () => {
    expect(parseComparisonMode("attributed")).toBe("attributed");
  });

  it("treats anything other than 'attributed' as anonymised, never a name leak", () => {
    for (const raw of ["", "Attributed", "ATTRIBUTED", "names", "attributed ",
      " true", "on", "1", "false", "anon", "attributed=true"]) {
      expect(parseComparisonMode(raw), JSON.stringify(raw)).toBe("anonymised");
    }
  });
});