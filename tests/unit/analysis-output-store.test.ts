import { describe, expect, it } from "vitest";
import type { AnalysisServeBody } from "../../lib/analyse-endpoint";
import {
  analysisOutputMeta,
  appendAnalysisHistory,
} from "../../lib/analysis-output-store";

// F14-T06 — the durable-retention store's pure seams (FR-35). The ticket's
// acceptance criteria that are safe to assert without a database run here; the
// DB-backed row behaviour (record + ordered retrieve, level column, RLS) is
// the gated integration spec in analysis-output-store.integration.test.ts.
//
//   1. Re-running preserves the prior output and its label — appendAnalysisHistory
//      keeps every earlier output, labels intact.
//   2. A model change between runs is visible in the labels — the meta
//      extraction records the pinned model per output.
//   3. Level is recorded per output — analysisOutputMeta captures the serving
//      level alongside every output, for both the model and deterministic
//      branches.

function readBody(
  model: string,
  generatedAt: string,
  level: "L0" = "L0",
): AnalysisServeBody {
  return {
    ok: true,
    level,
    scope: "question",
    questionId: "q8",
    analysis: {
      agreement: "agree",
      conflicts: [],
      askInRoom: ["ask"],
      wordingNote: null,
    },
    label: { model, generatedAt },
  };
}

function scoringBody(
  level: "L2" | "L3",
  generatedAt: string,
): AnalysisServeBody {
  return {
    ok: true,
    level,
    scope: "cohort",
    questionId: null,
    scoring: {
      scope: "cohort",
      questionId: null,
      results: [],
      exportOptions: { csv: "/api/admin/export", projection: "/admin/projection" },
    },
    label: { model: "", generatedAt },
  };
}

/** Narrow a stored body to the L0 read, so `.analysis` is type-safe. */
function readOf(body: AnalysisServeBody) {
  if (body.level !== "L0") throw new Error("expected an L0 read");
  return body;
}

describe("analysisOutputMeta — every output records its level, model and timestamp", () => {
  it("records the pinned model and level for a model-served read, with the generation timestamp", () => {
    const meta = analysisOutputMeta(
      readBody("claude-sonnet-4", "2026-08-17T12:34:00.000Z"),
    );
    expect(meta.scope).toBe("question");
    expect(meta.questionId).toBe("q8");
    expect(meta.level).toBe("L0");
    expect(meta.model).toBe("claude-sonnet-4");
    expect(meta.generatedAt).toBe("2026-08-17T12:34:00.000Z");
  });

  it("clears the model and keeps the level for a deterministic (L1/L2/L3) serve", () => {
    const meta = analysisOutputMeta(scoringBody("L2", "2026-08-17T13:00:00.000Z"));
    expect(meta.level).toBe("L2");
    expect(meta.model).toBe("");
    expect(meta.generatedAt).toBe("2026-08-17T13:00:00.000Z");
    expect(meta.scope).toBe("cohort");
    expect(meta.questionId).toBeNull();
  });

  it("surfaces a model change between runs in the recorded field", () => {
    const before = analysisOutputMeta(
      readBody("claude-sonnet-4", "2026-08-17T12:34:00.000Z"),
    );
    const after = analysisOutputMeta(
      readBody("claude-sonnet-5-0", "2026-08-17T13:00:00.000Z"),
    );
    expect(before.model).not.toBe(after.model);
    expect(before.generatedAt).not.toBe(after.generatedAt);
    expect(after.level).toBe("L0");
  });
});

describe("appendAnalysisHistory — a re-run retains the prior output and its label", () => {
  it("appends the fresh output, never overwriting the earlier ones", () => {
    const prior = readBody("claude-sonnet-4", "2026-08-17T12:34:00.000Z");
    const rerun = readBody("claude-sonnet-5-0", "2026-08-17T13:00:00.000Z");

    const history = appendAnalysisHistory([prior], rerun);
    expect(history).toHaveLength(2);
    // The prior output and its label are untouched.
    expect(history[0].label.model).toBe("claude-sonnet-4");
    expect(history[0].label.generatedAt).toBe("2026-08-17T12:34:00.000Z");
    expect(readOf(history[0]).analysis.agreement).toBe("agree");
    // The fresh output rides last with its own label.
    expect(history[1].label.model).toBe("claude-sonnet-5-0");
  });
});