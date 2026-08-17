import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_SYSTEM_PROMPT,
  ANALYSIS_RESULT_TOOL_NAME,
  type AnalysisOutput,
  type AnalysisRequestContext,
} from "../../lib/analysis-prompt";
import {
  ANALYSIS_REQUEST_OUTPUT_CAP,
} from "../../lib/budget";
import {
  ANALYSIS_QUEUE_MAX_ATTEMPTS,
  clearAnalysisQueue,
  drainAnalysisQueue,
  getCompletedAnalysis,
} from "../../lib/analysis-queue";
import {
  analysisScoringBody,
  buildAnalysisProviderRequest,
  gatewayPinForServedLevel,
  reportedDeterministicLevel,
  serveAnalysis,
  type AnalysisScoring,
} from "../../lib/analyse-endpoint";
import type { AIProvider, GatewayContext, ProviderResponse } from "../../lib/ai-gateway";

// F14-T02 — the /api/admin/analyse degradation contract, as the pure and near-
// pure seams that separate it from the route:
//
//   1. With the model unavailable (the key-removed case degrades to L2), the
//      response is the deterministic divergence scoring and a 200 — never an
//      error.
//   2. At L1 the analysis is queued and eventually completes without user
//      action (the queue itself is exercised in analysis-queue.test.ts; here
//      we assert serveAnalysis hands it the right work and returns the
//      queued-plus-scoring body).
//   3. The outbound payload keeps the §5.5 structure and carries no identity.

function analysisCtx(overrides: Partial<AnalysisRequestContext> = {}): AnalysisRequestContext {
  return {
    scope: "question",
    questionId: "q8",
    blocks: [
      {
        questionId: "q8",
        questionText: "Which wedge first?",
        positions: [
          { respondent: "A", text: "the referral is the scarce resource" },
          { respondent: "B", text: "centers hold the money and the daily pain" },
        ],
      },
    ],
    ...overrides,
  };
}

function gatewayCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    purpose: "analysis",
    pin: "L0",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    retryBackoffMs: 0,
    timeoutMs: 20,
    ...overrides,
  };
}

function okOutput(): AnalysisOutput {
  return {
    agreement: "The team shares the founding intent.",
    conflicts: [
      { between: "A and B", positions: ["Referral first.", "Centers first."] },
    ],
    askInRoom: ["What is actually scarce?"],
    wordingNote: null,
  };
}

function providerReply(output: AnalysisOutput): AIProvider {
  return {
    request: async (): Promise<ProviderResponse> => ({
      text: JSON.stringify(output),
      inputTokens: 10,
      outputTokens: 5,
      model: "pinned-model",
    }),
  };
}

function scoringFixture(): AnalysisScoring {
  return analysisScoringBody(
    "question",
    "q8",
    [
      {
        questionId: "q8",
        mode: "closed",
        included: 2,
        privateExcluded: 0,
        agreementRate: 0.5,
        modalAnswer: "pedconnect|teachday|parentup|pedmd",
        spread: 0.5,
        meanConfidence: 5,
        wordCounts: null,
        lengthSpread: null,
        category: "hard split",
      },
    ],
  );
}

beforeEach(() => {
  clearAnalysisQueue();
});

describe("buildAnalysisProviderRequest — the outbound payload stays minimal", () => {
  it("uses structured output (forced tool), the §5.5 system prompt and the analysis cap", () => {
    const req = buildAnalysisProviderRequest(analysisCtx(), "pinned-model");
    expect(req.model).toBe("pinned-model");
    expect(req.maxTokens).toBe(ANALYSIS_REQUEST_OUTPUT_CAP);
    expect(req.structuredOutput).toBeDefined();
    expect(req.structuredOutput!.system).toBe(ANALYSIS_SYSTEM_PROMPT);
    expect(req.structuredOutput!.tool.name).toBe(ANALYSIS_RESULT_TOOL_NAME);
  });

  it("carries only anonymised A/B/C positions — no name, id or email can ride in", () => {
    const req = buildAnalysisProviderRequest(analysisCtx(), "m");
    const message = req.structuredOutput!.userMessage;
    expect(message).toContain("Respondent A:");
    expect(message).toContain("Respondent B:");
    expect(message).toContain("the referral is the scarce resource");
    // The only responder identity that may appear is the anonymised letter. No
    // email, quoted name, id-style token, or the word used as a personal
    // field name in the wire shape may ride in.
    expect(message).not.toContain("@");
    expect(message).not.toMatch(/\bemail\b/);
    expect(message).not.toMatch(/\bcohortId\b|\bcohort_id\b|\brespondentId\b|\brespondent_id\b/);
  });
});

describe("level mapping", () => {
  it("gatewayPinForServedLevel keeps L0/L1/L2, maps L3 onto L2, keeps auto", () => {
    expect(gatewayPinForServedLevel("L0")).toBe("L0");
    expect(gatewayPinForServedLevel("L1")).toBe("L1");
    expect(gatewayPinForServedLevel("L2")).toBe("L2");
    expect(gatewayPinForServedLevel("L3")).toBe("L2");
    expect(gatewayPinForServedLevel("auto")).toBe("auto");
  });

  it("reportedDeterministicLevel preserves an L3 pin and otherwise reports L2", () => {
    expect(reportedDeterministicLevel("L2")).toBe("L2");
    expect(reportedDeterministicLevel("L3")).toBe("L3");
    expect(reportedDeterministicLevel("L1")).toBe("L2");
  });
});

describe("serveAnalysis — the served level decides the response", () => {
  it("L0 serves the parsed analysis and never pays for a scoring read", async () => {
    const scoring = vi.fn(async () => scoringFixture());
    const body = await serveAnalysis(
      analysisCtx(),
      gatewayCtx({ pin: "L0" }),
      providerReply(okOutput()),
      "pinned-model",
      "L0",
      "cohort:q8",
      () => Promise.resolve({ done: true, output: okOutput() }),
      scoring,
    );

    if (body.level !== "L0") throw new Error("expected an L0 body");
    expect(body.ok).toBe(true);
    expect(body.analysis.agreement).toBe(okOutput().agreement);
    expect(body.analysis.conflicts).toEqual(okOutput().conflicts);
    // A healthy request must not run the cohort-wide scoring read.
    expect(scoring).not.toHaveBeenCalled();
    expect(getCompletedAnalysis("cohort:q8")).toBeUndefined();
  });

  it("a clean L0 reply that does not parse as §5.5 output degrades to L2 scoring", async () => {
    const freeText: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: "Here is my analysis.",
        inputTokens: 1,
        outputTokens: 1,
        model: "pinned-model",
      }),
    };
    const body = await serveAnalysis(
      analysisCtx(),
      gatewayCtx({ pin: "L0" }),
      freeText,
      "pinned-model",
      "L0",
      "cohort:q8",
      () => Promise.resolve({ done: false, output: null }),
      async () => scoringFixture(),
    );

    if (body.level === "L0") throw new Error("expected a degraded body");
    expect(body.level).toBe("L2");
    if (!("scoring" in body)) throw new Error("expected a scoring body");
    expect(body.scoring.results[0].category).toBe("hard split");
  });

  it("L3 serves the deterministic scoring labelled L3", async () => {
    const body = await serveAnalysis(
      analysisCtx(),
      gatewayCtx({ pin: "L2" }), // gateway has no L3; L3 maps onto L2
      providerReply(okOutput()),
      "pinned-model",
      "L3",
      "cohort:q8",
      () => Promise.resolve({ done: true, output: okOutput() }),
      async () => scoringFixture(),
    );
    expect(body.level).toBe("L3");
    if (!("scoring" in body)) throw new Error("expected a scoring body");
    expect(body.scoring.exportOptions.projection).toBe("/admin/projection");
  });
});

describe("serveAnalysis — the key-removed case returns scoring and a 200 (acceptance 1)", () => {
  it("a degraded L2 serve (the key-removed local default) yields scoring, never an error", async () => {
    // A provider that cannot reach a model: the gateway resolves its failure to
    // L2 and the deterministic scoring is served, so POST /api/admin/analyse is
    // a 200 with usable data rather than a 5xx.
    const broken: AIProvider = {
      request: async (): Promise<ProviderResponse> => {
        throw new Error("no provider configured");
      },
    };
    const body = await serveAnalysis(
      analysisCtx(),
      gatewayCtx({ pin: "L2" }),
      broken,
      "pinned-model",
      "L2",
      "cohort:q8",
      () => Promise.resolve({ done: false, output: null }),
      async () => scoringFixture(),
    );

    expect(body.level).toBe("L2");
    if (!("scoring" in body)) throw new Error("expected a scoring body");
    expect(body.scoring.results).toHaveLength(1);
    expect(body.scoring.exportOptions.csv).toBe("/api/admin/export");
    // Nothing was queued — L2 is not a retry state.
    expect(getCompletedAnalysis("cohort:q8")).toBeUndefined();
  });
});

describe("serveAnalysis — at L1 the analysis is queued and eventually completes (acceptance 2)", () => {
  it("queues a background retry and returns queued plus the deterministic scoring", async () => {
    const output = okOutput();
    const body = await serveAnalysis(
      analysisCtx(),
      gatewayCtx({ pin: "L1" }),
      providerReply(output),
      "pinned-model",
      "L1",
      "cohort:q8",
      // The worker this body enqueues lands at L0 on its own first attempt.
      () => Promise.resolve({ done: true, output }),
      async () => scoringFixture(),
    );

    expect(body.level).toBe("L1");
    if (body.level !== "L1" || !("scoring" in body)) {
      throw new Error("expected an L1 scoring body");
    }
    expect(body.queued).toBe(true);
    expect(body.scoring.results[0].questionId).toBe("q8");

    // The queued analysis completed without any further user action.
    await drainAnalysisQueue();
    expect(getCompletedAnalysis("cohort:q8")).toEqual(output);

    // The work given to the queue sets the retry budget, not an unbounded loop.
    expect(ANALYSIS_QUEUE_MAX_ATTEMPTS).toBeGreaterThanOrEqual(1);
  });
});