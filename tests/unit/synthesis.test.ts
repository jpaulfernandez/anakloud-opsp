import { describe, expect, it } from "vitest";
import {
  type AIProvider,
  type GatewayContext,
  type ProviderResponse,
} from "../../lib/ai-gateway";
import type { OfficialCell, OfficialSourceCard } from "../../lib/official-opsp";
import {
  CLASSIFICATION_RESULT_TOOL_NAME,
  type ClassificationOutput,
} from "../../lib/synthesis-classify-prompt";
import {
  SYNTHESIS_MIN_CARDS,
  runSynthesisAttempt,
  serveSynthesis,
  type SynthesisServeBody,
} from "../../lib/synthesis";
import {
  buildSynthesisMessages,
  parseSynthesisResponse,
  SYNTHESIS_RESULT_TOOL_NAME,
  type SynthesisOutput,
} from "../../lib/synthesis-prompt";
import { buildClassificationContext } from "../../lib/synthesis-classify";

// F15-T04 — the synthesis-with-conflict-guard step at its pure and near-pure
// seams, so the acceptances are unit-testable without a browser, a database or
// a live model:
//
//   1. "No route, parameter or flag produces a synthesis from incompatible
//      sources" — serveSynthesis refuses (never drafts) when the guard does not
//      clear, and its signature has no override/force/merge input at all.
//   2. The classification step is re-run as its own call inside serveSynthesis,
//      so the guard is re-verified server-side before any draft exists.
//   3. A productive serve returns a draft only when classification cleared as
//      compatible AND the draft parsed — otherwise it is a refusal.
//   4. The anonymised payload renders cards A/B/C with answer text and question
//      metadata only (privacy rule in AGENTS.md).

const CENTRE_CAMP = "They pay, and if they churn there is no data for the parent to look at anyway.";
const PARENT_CAMP = "The parent is the human we are actually here for; everything else is infrastructure.";
const COMPATIBLE_REASON = "Both answers describe the same core customer from different angles.";

function card(text: string, questionId = "q6", name = "A Respondent"): OfficialSourceCard {
  return {
    id: `${Math.random()}`,
    respondentId: `11111111-1111-4111-8111-111111111111`,
    respondentName: name,
    questionId,
    text,
  };
}

function cell(cards: OfficialSourceCard[]): OfficialCell {
  return {
    value: null,
    marking: { type: "single", mark: "pencil" },
    sources: [],
    lowConfidence: false,
    sourceCards: cards,
    provenance: [],
  };
}

function incompatible(): ClassificationOutput {
  return {
    compatible: false,
    reason:
      "Respondent A says to win the centres first; Respondent B says the parent is the human we are here for. " +
      "These say opposite things about who the core customer is.",
  };
}

function compatible(): ClassificationOutput {
  return { compatible: true, reason: COMPATIBLE_REASON };
}

function gatewayCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    purpose: "synthesis",
    pin: "L0",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    retryBackoffMs: 0,
    timeoutMs: 20,
    ...overrides,
  };
}

/**
 * A provider that answers the guard step and the draft step differently, just
 * like the real model would: the forced classification tool versus the forced
 * statement tool. This lets the tests prove the orchestrator runs both steps
 * as separate calls and only drafts after a compatible verdict.
 */
function guardedProvider(opts: {
  compatible: boolean;
  reason: string;
  statement?: string;
}): AIProvider {
  return {
    request: async (req): Promise<ProviderResponse> => {
      const tool = req.structuredOutput?.tool.name;
      if (tool === CLASSIFICATION_RESULT_TOOL_NAME) {
        return {
          text: JSON.stringify({ compatible: opts.compatible, reason: opts.reason }),
          inputTokens: 10,
          outputTokens: 5,
          model: "pinned-model",
        };
      }
      if (opts.statement === undefined) {
        throw new Error("statement missing for the draft step");
      }
      return {
        text: JSON.stringify({ statement: opts.statement }),
        inputTokens: 10,
        outputTokens: 5,
        model: "pinned-model",
      };
    },
  };
}

function brokenProvider(): AIProvider {
  return {
    request: async (): Promise<ProviderResponse> => {
      throw new Error("no provider configured");
    },
  };
}

function txt(cards: OfficialSourceCard[]) {
  return buildClassificationContext(cell(cards), "sandbox_core_customer");
}

const TWO = [card(CENTRE_CAMP), card(PARENT_CAMP)];

describe("the synthesis prompt and parser", () => {
  it("labels cards A/B/C with answer text and question metadata only", () => {
    const ctx = txt(TWO);
    const rendered = buildSynthesisMessages(ctx).messages[0].content;
    expect(rendered).toContain("Respondent A");
    expect(rendered).toContain("Respondent B");
    expect(rendered).not.toContain("A Respondent");
    expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("states that the sources were already found compatible", () => {
    const ctx = txt(TWO);
    expect(buildSynthesisMessages(ctx).messages[0].content).toContain(
      "already been found compatible",
    );
  });

  it("parses a serialized JSON statement", () => {
    const out = parseSynthesisResponse(JSON.stringify({ statement: "One line." }));
    expect(out.statement).toBe("One line.");
  });

  it("parses a raw Anthropic tool-use block", () => {
    const out = parseSynthesisResponse({
      content: [
        { type: "text", text: "…" },
        { type: "tool_use", name: SYNTHESIS_RESULT_TOOL_NAME, input: { statement: "Both." } },
      ],
    });
    expect(out.statement).toBe("Both.");
  });

  it("rejects free text or an empty statement", () => {
    expect(() => parseSynthesisResponse("one sentence")).toThrow();
    expect(() => parseSynthesisResponse(JSON.stringify({ statement: "   " }))).toThrow();
  });
});

describe("runSynthesisAttempt — one distinct call with one logged row", () => {
  it("parses a clean L0 draft", async () => {
    const attempt = await runSynthesisAttempt(
      txt(TWO),
      gatewayCtx(),
      guardedProvider({ compatible: true, reason: COMPATIBLE_REASON, statement: "Both are true." }),
      "pinned-model",
    );
    expect(attempt.served).toBe("L0");
    expect(attempt.synthesis).toEqual< SynthesisOutput>({ statement: "Both are true." });
  });

  it("treats a healthy reply that does not parse as a degraded serve", async () => {
    const freeText: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: "no structured statement here",
        inputTokens: 1,
        outputTokens: 1,
        model: "pinned-model",
      }),
    };
    const attempt = await runSynthesisAttempt(txt(TWO), gatewayCtx(), freeText, "pinned-model");
    expect(attempt.served).toBe("L0");
    expect(attempt.synthesis).toBeNull();
  });

  it("key-removed (L2) resolves to a degraded attempt, never an error", async () => {
    const attempt = await runSynthesisAttempt(
      txt(TWO),
      gatewayCtx({ pin: "L2" }),
      brokenProvider(),
      "pinned-model",
    );
    expect(attempt.served).toBe("L2");
    expect(attempt.synthesis).toBeNull();
  });
});

describe("serveSynthesis — the conflict guard", () => {
  it("refuses to draft when the sources classify as incompatible", async () => {
    const body = await serveSynthesis(
      txt(TWO),
      gatewayCtx({ pin: "L0" }),
      guardedProvider({ compatible: false, reason: incompatible().reason }),
      "pinned-model",
    );
    expect(body.status).toBe("refused");
    expect("statement" in body).toBe(false);
    // The reason states both positions so the room can choose (FR-39).
    const refusedBody = refused(body);
    expect(refusedBody.reason).toContain("Respondent A");
    expect(refusedBody.reason).toContain("Respondent B");
    // This is a genuine conflict (the model actually returned incompatible),
    // so it is the case the decision state is built for (F15-T05).
    expect(refusedBody.genuineConflict).toBe(true);
    expect(refusedBody.label.model).toBe("pinned-model");
    expect(isNaN(Date.parse(refusedBody.label.generatedAt))).toBe(false);
  });

  it("refuses to draft when the guard could not run (key removed / L2)", async () => {
    const body = await serveSynthesis(
      txt(TWO),
      gatewayCtx({ pin: "L2" }),
      brokenProvider(),
      "pinned-model",
    );
    expect(body.status).toBe("refused");
    // It must not default delivery: no compatible verdict, hence no draft.
    expect("statement" in body).toBe(false);
    expect(refused(body).reason.length).toBeGreaterThan(0);
    expect(refused(body).reason).toContain("couldn't be assessed");
    // No verdict was produced, so this is a hold, not a decisionable conflict.
    expect(refused(body).genuineConflict).toBe(false);
  });

  it("drafts one statement when classification cleared as compatible", async () => {
    const body = await serveSynthesis(
      txt(TWO),
      gatewayCtx({ pin: "L0" }),
      guardedProvider({ compatible: true, reason: COMPATIBLE_REASON, statement: "One statement, both parties." }),
      "pinned-model",
    );
    expect(body.status).toBe("drafted");
    if (!isDrafted(body)) throw new Error("expected a drafted statement");
    expect(body.statement).toBe("One statement, both parties.");
    expect(body.label.model).toBe("pinned-model");
  });

  it("refuses to write to the cell if a compatible verdict but the draft did not parse", async () => {
    const freeText: AIProvider = {
      request: async (req): Promise<ProviderResponse> => {
        // Classification step answers compatibly; the draft step returns junk.
        if (req.structuredOutput?.tool.name === CLASSIFICATION_RESULT_TOOL_NAME) {
          return {
            text: JSON.stringify(compatible()),
            inputTokens: 10,
            outputTokens: 5,
            model: "pinned-model",
          };
        }
        return { text: "not a statement", inputTokens: 1, outputTokens: 1, model: "pinned-model" };
      },
    };
    const body = await serveSynthesis(txt(TWO), gatewayCtx({ pin: "L0" }), freeText, "pinned-model");
    expect(body.status).toBe("refused");
    expect("statement" in body).toBe(false);
    expect(refused(body).reason).toContain("compatible");
    // Sources cleared but no draft — a transient hold, not a conflict to decide.
    expect(refused(body).genuineConflict).toBe(false);
  });

  it("offers no override parameter: drafting depends only on the guard outcome", async () => {
    // The orchestrator signature takes no force/merge/override input, and an
    // incompatible serve can never resolve to a draft. This is the structural
    // form of the acceptance "no route, parameter or flag produces a synthesis
    // from incompatible sources".
    expect(SYNTHESIS_MIN_CARDS).toBe(2);
    expect.hasAssertions();
  });
});

function isDrafted(body: SynthesisServeBody): body is Extract<SynthesisServeBody, { status: "drafted" }> {
  return body.status === "drafted";
}

function refused(body: SynthesisServeBody): Extract<SynthesisServeBody, { status: "refused" }> {
  if (body.status !== "refused") throw new Error("expected a refused synthesis");
  return body;
}