import { describe, expect, it } from "vitest";
import {
  ANALYSIS_PANEL_TITLE,
  ANALYSIS_PREP_LABEL,
  formatAnalysisTimestamp,
  isAnalysisRead,
  labelledRuns,
  percentLabel,
  runFooterText,
  SCORING_PANEL_TITLE,
} from "../../lib/analysis-panel";
import type { AnalysisServeBody } from "../../lib/analyse-endpoint";

// F14-T03/F14-T06 — the analysis side panel's pure display model (FR-35,
// ui_ux.md §4.19). These are the acceptance criteria that are safe to assert
// without a browser or a model:
//
//   1. The standing label is the exact verbatim prep wording.
//   2. Every output's footer carries a deterministic model + timestamp label,
//      with the serving level recorded alongside (F14-T06).
//   3. Re-running retains every previous output — history renders as runs,
//      each keeping its label, and a model change between runs is visible.
//   4. The read-vs-deterministic decision reads only the served level — and
//      the deterministic panel title frames it as its own feature, with no
//      error/"unavailable" language anywhere in the model.

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

describe("footer labelling — level, model and timestamp on every output (FR-35, F14-T06)", () => {
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

  it("records the serving level alongside the model and timestamp when a model ran", () => {
    expect(
      runFooterText("L0", "opencode/sonnet-test", "2026-08-17T12:34:00.000Z"),
    ).toBe("L0 · opencode/sonnet-test · 2026-08-17 12:34 UTC");
  });

  it("records the serving level with no model word in the deterministic branch, never an 'unavailable' affordance", () => {
    expect(runFooterText("L2", "", "2026-08-17T12:34:00.000Z")).toBe(
      "L2 · 2026-08-17 12:34 UTC",
    );
    const label = runFooterText("L3", "", "2026-08-17T12:34:00.000Z");
    expect(label).not.toContain("unavailable");
    expect(label).not.toContain("error");
    expect(label.startsWith("L3 ·")).toBe(true);
  });
});

describe("a model change between runs is visible in the labels (F14-T06)", () => {
  it("produces different footers when the pinned model changes between runs", () => {
    const before = runFooterText("L0", "claude-sonnet-4", "2026-08-17T12:34:00.000Z");
    const after = runFooterText("L0", "claude-sonnet-5-0", "2026-08-17T13:00:00.000Z");
    expect(before).not.toBe(after);
    expect(before).toContain("claude-sonnet-4");
    expect(after).toContain("claude-sonnet-5-0");
  });
});

describe("re-running retains every previous output and its label (F14-T06)", () => {
  function readBody(
    model: string,
    generatedAt: string,
    agreement: string,
  ): AnalysisServeBody {
    return {
      ok: true,
      level: "L0",
      scope: "question",
      questionId: "q8",
      analysis: {
        agreement,
        conflicts: [],
        askInRoom: ["ask"],
        wordingNote: null,
      },
      label: { model, generatedAt },
    };
  }

  /** Narrow a stored body to the L0 read, so `.analysis` is type-safe. */
  function readOf(body: AnalysisServeBody) {
    if (body.level !== "L0") throw new Error("expected an L0 read");
    return body;
  }

  it("renders the retained history as labelled runs, oldest first, none discarded", () => {
    const prior = readBody(
      "claude-sonnet-4",
      "2026-08-17T12:34:00.000Z",
      "agree before",
    );
    const rerun = readBody(
      "claude-sonnet-5-0",
      "2026-08-17T13:00:00.000Z",
      "agree after",
    );

    const runs = labelledRuns([prior, rerun]);
    expect(runs).toHaveLength(2);
    // Both outputs are retained, prior first, each with its own label fields.
    expect(runs[0].body.label.model).toBe("claude-sonnet-4");
    expect(runs[1].body.label.model).toBe("claude-sonnet-5-0");
    expect(readOf(runs[0].body).analysis.agreement).toBe("agree before");
    expect(readOf(runs[1].body).analysis.agreement).toBe("agree after");
    // The serving level rides with each output.
    expect(runs[0].body.level).toBe("L0");
    expect(runs[1].body.level).toBe("L0");
    // And the visible labels differ — the model change is apparent in the UI.
    expect(
      runFooterText(runs[0].body.level, runs[0].body.label.model, runs[0].body.label.generatedAt),
    ).not.toBe(
      runFooterText(runs[1].body.level, runs[1].body.label.model, runs[1].body.label.generatedAt),
    );
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