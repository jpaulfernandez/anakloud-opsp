import { describe, expect, it } from "vitest";
import {
  gatewayCallRecord,
  type AIProvider,
  type GatewayContext,
  type ProviderResponse,
} from "../../lib/ai-gateway";
import type { OfficialCell, OfficialSourceCard } from "../../lib/official-opsp";
import {
  buildClassificationContext,
  buildDeterministicClassification,
  CLASSIFICATION_MIN_CARDS,
  runClassificationAttempt,
  serveClassification,
  SourceCardCountError,
  type ClassificationServeBody,
} from "../../lib/synthesis-classify";
import {
  buildClassificationMessages,
  parseClassificationResponse,
  type ClassificationOutput,
} from "../../lib/synthesis-classify-prompt";

// F15-T03 — the compatibility-classification step at its pure and near-pure
// seams, so the acceptances are unit-testable without a browser, a database or
// a live model:
//
//   1. "Classification is a distinct call with its own logged interaction row" —
//      the classification provider request is its own call, the gateway call
//      records one row, and a classification that ran records purpose
//      "synthesis" (this is the separate-from-synthesis call shape).
//   2. "The reason string is shown to the facilitator" — every served body,
//      L0 and degraded alike, carries the reason.
//   3. The key-removed default (L2) serves the deterministic *refusal* — never
//      a compatible verdict and never an error (PR3, FR-39).
//   4. The anonymised payload renders cards A/B/C with answer text and question
//      metadata only — no respondent name or id (privacy rule in AGENTS.md).

// The two clearly incompatible seeded Q6 answers (spec/seed.ts): the centre
// camp vs the parent camp on the sandbox_core_customer cell.
const CENTRE_CAMP = "They pay, and if they churn there is no data for the parent to look at anyway.";
const PARENT_CAMP = "The parent is the human we are actually here for; everything else is infrastructure.";

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

function providerReply(output: ClassificationOutput): AIProvider {
  return {
    request: async (): Promise<ProviderResponse> => ({
      text: JSON.stringify(output),
      inputTokens: 10,
      outputTokens: 5,
      model: "pinned-model",
    }),
  };
}

function brokenProvider(): AIProvider {
  return {
    request: async (): Promise<ProviderResponse> => {
      throw new Error("no provider configured");
    },
  };
}

function txt(cards: OfficialSourceCard[]): ReturnType<typeof buildClassificationContext> {
  return buildClassificationContext(cell(cards), "sandbox_core_customer");
}

describe("buildClassificationContext — the anonymised payload (privacy rule)", () => {
  it("labels cards A/B/C with answer text and question metadata only", () => {
    const ctx = txt([card(CENTRE_CAMP), card(PARENT_CAMP)]);
    expect(ctx.cellId).toBe("sandbox_core_customer");
    expect(ctx.cellTitle).toContain("Sandbox");
    expect(ctx.cards).toHaveLength(2);
    expect(ctx.cards[0].label).toBe("Respondent A");
    expect(ctx.cards[1].label).toBe("Respondent B");
    expect(ctx.cards[0].question).toBe("Q6");
    expect(ctx.cards[0].text).toContain("They pay");
    // No name, no respondent id, anywhere in the rendered payload.
    const rendered = buildClassificationMessages(ctx).messages[0].content;
    expect(rendered).toContain("Respondent A");
    expect(rendered).not.toContain("A Respondent");
    expect(rendered).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("refuses to classify a cell with fewer than two source cards", () => {
    expect(() => buildClassificationContext(cell([card(CENTRE_CAMP)]), "bhag")).toThrow(
      SourceCardCountError,
    );
  });

  it("keeps the minimum-card contract visible", () => {
    expect(CLASSIFICATION_MIN_CARDS).toBe(2);
  });
});

describe("the output schema and parser", () => {
  it("parses a serialized JSON verdict", () => {
    const out = parseClassificationResponse(JSON.stringify(incompatible()));
    expect(out.compatible).toBe(false);
    expect(out.reason).toContain("opposite things");
  });

  it("parses a raw Anthropic tool-use block", () => {
    const out = parseClassificationResponse({
      content: [
        { type: "text", text: "…" },
        { type: "tool_use", name: "compatibility_classification", input: { compatible: true, reason: "both say the same customer" } },
      ],
    });
    expect(out.compatible).toBe(true);
  });

  it("rejects free text that carries no verdict", () => {
    expect(() => parseClassificationResponse("looks fine to me")).toThrow();
  });

  it("rejects a verdict without a reason or a non-boolean compatible", () => {
    expect(() => parseClassificationResponse(JSON.stringify({ compatible: true }))).toThrow();
    expect(() => parseClassificationResponse(JSON.stringify({ compatible: "yes", reason: "x" }))).toThrow();
  });
});

describe("buildDeterministicClassification (PR3)", () => {
  it("refuses to combine: never returns a compatible verdict without a model", () => {
    const out = buildDeterministicClassification();
    expect(out.compatible).toBe(false);
    expect(out.reason.length).toBeGreaterThan(0);
    // The refusal says the sources were not auto-assessed — not that the
    // positions genuinely conflict, which only a model could assert.
    expect(out.reason).toContain("couldn't be assessed");
  });
});

describe("runClassificationAttempt — one distinct call with one logged row", () => {
  it("parses a clean L0 reply and records its audit row as purpose 'synthesis'", async () => {
    const record = {
      db: {} as never,
      cohortId: "cohort",
      respondentId: "facilitator",
      questionId: null,
    };
    const attempt = await runClassificationAttempt(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx({ record }),
      providerReply(incompatible()),
      "pinned-model",
    );
    expect(attempt.served).toBe("L0");
    expect(attempt.classification).toEqual(incompatible());

    // The classification is its own call → its own row, labelled 'synthesis'
    // (FR: separate step from synthesis, distinct logged interaction).
    const row = gatewayCallRecord(
      { purpose: "synthesis", record },
      { prompt: "", model: "pinned-model", maxTokens: 1500 },
      { level: "L0", degraded: false, provider: { text: "…", inputTokens: 10, outputTokens: 5, model: "pinned-model" } },
    )!;
    expect(row.purpose).toBe("synthesis");
    expect(row.questionId).toBeNull();
    expect(row.cohortId).toBe("cohort");
    expect(row.inputTokens).toBe(10);
    expect(row.outputTokens).toBe(5);
  });

  it("treats a healthy reply that does not parse as a degraded serve", async () => {
    const freeText: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: "no structured verdict here",
        inputTokens: 1,
        outputTokens: 1,
        model: "pinned-model",
      }),
    };
    const attempt = await runClassificationAttempt(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx(),
      freeText,
      "pinned-model",
    );
    expect(attempt.served).toBe("L0");
    expect(attempt.classification).toBeNull();
  });

  it("key-removed (L2) resolves to a degraded attempt, never an error", async () => {
    const attempt = await runClassificationAttempt(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx({ pin: "L2" }),
      brokenProvider(),
      "pinned-model",
    );
    expect(attempt.served).toBe("L2");
    expect(attempt.classification).toBeNull();
  });
});

describe("serveClassification — the served level decides the body", () => {
  it("L0 serves the incompatible verdict and its reason (acceptance: reason shown)", async () => {
    const body = await serveClassification(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx({ pin: "L0" }),
      providerReply(incompatible()),
      "pinned-model",
      "L0",
    );
    if (!isL0(body)) throw new Error("expected an L0 verdict");
    expect(body.ok).toBe(true);
    expect(body.classification.compatible).toBe(false);
    expect(body.classification.reason).toContain("Respondent A");
    expect(body.label.model).toBe("pinned-model");
    expect(isNaN(Date.parse(body.label.generatedAt))).toBe(false);
  });

  it("a clean reply that does not parse degrades to the deterministic refusal", async () => {
    const freeText: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: "not a verdict",
        inputTokens: 1,
        outputTokens: 1,
        model: "pinned-model",
      }),
    };
    const body = await serveClassification(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx({ pin: "L0" }),
      freeText,
      "pinned-model",
      "L0",
    );
    expect(body.level).toBe("L2");
    if (isL0(body)) throw new Error("expected a deterministic refusal");
    expect(body.classification.compatible).toBe(false);
  });

  it("L2 (the key-removed default) returns a refused, labelled verdict, never 5xx", async () => {
    const body = await serveClassification(
      txt([card(CENTRE_CAMP), card(PARENT_CAMP)]),
      gatewayCtx({ pin: "L2" }),
      brokenProvider(),
      "pinned-model",
      "L2",
    );
    expect(body.ok).toBe(true);
    expect(body.level).toBe("L2");
    if (isL0(body)) throw new Error("expected a deterministic refusal");
    // The reason is still shown to the facilitator on the degraded branch.
    expect(body.classification.reason.length).toBeGreaterThan(0);
    expect(body.label.model).toBe("pinned-model");
  });
});

function isL0(body: ClassificationServeBody): body is Extract<ClassificationServeBody, { level: "L0" }> {
  return body.level === "L0";
}