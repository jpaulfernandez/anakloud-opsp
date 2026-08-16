import { describe, expect, it } from "vitest";
import {
  ANALYSIS_PANEL_TITLE,
  ANALYSIS_PREP_LABEL,
  formatAnalysisTimestamp,
  isAnalysisRead,
  percentLabel,
  runFooterText,
  SCORING_PANEL_TITLE,
} from "../../lib/analysis-panel";
import type { AnalysisServeBody } from "../../lib/analyse-endpoint";

// F14-T03 — the analysis side panel's pure display model (FR-35, ui_ux.md
// §4.19). These are the acceptance criteria that are safe to assert without a
// browser or a model:
//
//   1. The standing label is the exact verbatim prep wording.
//   2. Every output's footer carries a deterministic model + timestamp label.
//   3. The read-vs-deterministic decision reads only the served level — and
//      the deterministic panel title frames it as its own feature, with no
//      error/"unavailable" language anywhere in the model.
//   4. The deterministic breakdown renders agreement as a clean percentage,
//      using the em-dash where no rate exists.

function serveBody(
  overrides: Partial<AnalysisServeBody> = {},
): AnalysisServeBody {
  return {
    ok: true,
    level: "L2",
    scope: "question",
    questionId: "q8",
    scoring: {
      scope: "question",
      questionId: "q8",
      results: [],
      exportOptions: { csv: "/api/admin/export", projection: "/admin/projection" },
    },
    label: { model: "", generatedAt: "2026-08-17T12:34:00.000Z" },
    ...overrides,
  } as AnalysisServeBody;
}

describe("the standing prep label (acceptance — verbatim wording)", () => {
  it("is exactly the ui_ux §4.19 sentence", () => {
    expect(ANALYSIS_PREP_LABEL).toBe(
      "Prep material. Not a finding to show the team.",
    );
  });
});

describe("footer labelling — model name and timestamp on every output (FR-35)", () => {
  it("formats an ISO timestamp into a stable UTC footer form", () => {
    expect(formatAnalysisTimestamp("2026-08-17T12:34:00.000Z")).toBe(
      "2026-08-17 12:34 UTC",
    );
    expect(formatAnalysisTimestamp("2026-01-05T00:00:00.000Z")).toBe(
      "2026-01-05 00:00 UTC",
    );
  });

  it("returns an empty label for an unparseable timestamp, never 'Invalid Date'", () => {
    expect(formatAnalysisTimestamp("not-a-date")).toBe("");
  });

  it("composes the footer as model + timestamp when a model ran", () => {
    expect(
      runFooterText("opencode/sonnet-test", "2026-08-17T12:34:00.000Z"),
    ).toBe("opencode/sonnet-test · 2026-08-17 12:34 UTC");
  });

  it("shows only the timestamp when no model ran (deterministic branch), never an 'unavailable' affordance", () => {
    expect(runFooterText("", "2026-08-17T12:34:00.000Z")).toBe(
      "2026-08-17 12:34 UTC",
    );
    expect(runFooterText("", "2026-08-17T12:34:00.000Z")).not.toContain(
      "unavailable",
    );
    expect(runFooterText("", "2026-08-17T12:34:00.000Z")).not.toContain("error");
  });
});

describe("the read-vs-deterministic decision", () => {
  it("is a read only when the served level is L0", () => {
    expect(
      isAnalysisRead(serveBody({ level: "L0", analysis: { agreement: "x", conflicts: [], askInRoom: [], wordingNote: null } })),
    ).toBe(true);
    expect(isAnalysisRead(serveBody({ level: "L1" }))).toBe(false);
    expect(isAnalysisRead(serveBody({ level: "L2" }))).toBe(false);
    expect(isAnalysisRead(serveBody({ level: "L3" }))).toBe(false);
  });

  it("names the deterministic panel as its own feature, not a downgrade", () => {
    expect(SCORING_PANEL_TITLE).toBe("Divergence scoring");
    expect(SCORING_PANEL_TITLE.toLowerCase()).not.toContain("fallback");
    expect(SCORING_PANEL_TITLE.toLowerCase()).not.toContain("degrad");
    expect(SCORING_PANEL_TITLE.toLowerCase()).not.toContain("unavailable");
  });
});

describe("the deterministic breakdown formatting", () => {
  it("turns an agreement rate into a whole percentage", () => {
    expect(percentLabel(1)).toBe("100%");
    expect(percentLabel(0.5)).toBe("50%");
    expect(percentLabel(0.33)).toBe("33%");
  });

  it("uses the em-dash where no agreement rate exists (open-text review)", () => {
    expect(percentLabel(null)).toBe("—");
  });
});

describe("panel titles", () => {
  it("labels the model-served panel plainly as 'Analysis'", () => {
    expect(ANALYSIS_PANEL_TITLE).toBe("Analysis");
  });
});