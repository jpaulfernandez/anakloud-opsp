import { beforeEach, describe, expect, it } from "vitest";
import { ANALYSIS_PREP_LABEL } from "../../lib/analysis-panel";
import {
  clearAnalysisQueue,
  drainAnalysisQueue,
  getCompletedAnalysis,
} from "../../lib/analysis-queue";
import type { AIProvider, GatewayContext, ProviderResponse } from "../../lib/ai-gateway";
import { buildOpspCells, type OpspSourceAnswers } from "../../lib/opsp";
import {
  buildOpspAnalysisContextFromCells,
  buildOpspDeterministicSummary,
  OPSP_ANONYMISED_TEAMMATE_LABEL,
  opspMarkLabel,
  redactRespondentIds,
  serveOpspAnalysis,
  type OwnedIndividualDraft,
} from "../../lib/opsp-analysis";
import type { OpspAnalysisOutput } from "../../lib/opsp-analysis-prompt";

// F14-T04 — the individual-OPSP strengths/gaps read at its pure and near-pure
// seams, so the acceptances are unit-testable without a browser, a database or
// a live model:
//
//   1. "A seeded self-contradicting OPSP produces a contradiction finding" —
//      build a genuinely self-contradicting plan through the real F07-T01
//      mapping, assert both contradictory cells reach the payload, then run the
//      real orchestrator with the provider boundary mocked to return that
//      contradiction and assert the served L0 read carries it.
//   2. The key-removed case serves the deterministic structural sibling and a
//      200, never an error (PR3).
//   3. Every output is labelled and re-runnable (FR-35) and marked as prep
//      material.
//   4. The anonymised context renders no respondent id — q14(b) teammate ids
//      become a neutral label.

const UUID = "22222222-2222-4222-8222-222222222222";

/** A plan that contradicts itself: the Brand Promise names parents as the
 * customer while the Profit-per-X and Sandbox-core cells bill centers. */
const SELF_CONTRADICTING: OpspSourceAnswers = {
  q1: { value: { text: "Therapy centers run on notebooks and Viber groups; we give them the system they would have if software were built for this market." }, confidence: null },
  q4: { value: { text: "Every child in the Philippines with a developmental delay is identified before age five." }, confidence: null },
  q3: { value: { metric: "paying therapy centers", value: 300, unit: "paying_centers" }, confidence: null },
  q5: { value: { pays: ["center_owner"], decides: ["center_owner"], uses: ["occupational_therapist"], benefits: ["child"] }, confidence: null },
  q6: { value: { choice: "center", why: "Centers pay; if they churn there is no product." }, confidence: null },
  q7: { value: { text: "Parents are our customer; we make their lives better first." }, confidence: null },
  q10: { value: { payer: "center", model: "monthly_subscription", amount: 2500, unit: "per_center", first_peso: "2027-01" }, confidence: null },
};

function draft(cells: ReturnType<typeof buildOpspCells>): OwnedIndividualDraft {
  return { id: "draft-id", version: 1, cells };
}

function cellsOf(snapshot: OpspSourceAnswers): ReturnType<typeof buildOpspCells> {
  return buildOpspCells(snapshot);
}

function okOutput(): OpspAnalysisOutput {
  return {
    consistentCells: ["purpose", "bhag", "three_year_targets", "sandbox_core_customer", "brand_promise"],
    contradictions: [
      {
        between: "brand_promise and profit_per_x",
        positions: [
          "Parents are our customer; we make their lives better first.",
          "Payer: center; monthly subscription billed per center.",
        ],
      },
    ],
    unfalsifiableCells: [{ cell: "bhag", reason: "no measure is attached" }],
    readNote: "The plan names parents as the customer while the profit model bills centers.",
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

function providerReply(output: OpspAnalysisOutput): AIProvider {
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

beforeEach(() => {
  clearAnalysisQueue();
});

describe("the anonymised context (payload privacy, spec.md §8)", () => {
  it("renders the contradictory cells into the payload, blank cells stay out", () => {
    const ctx = buildOpspAnalysisContextFromCells(
      cellsOf(SELF_CONTRADICTING),
      "A",
      1,
    );

    const texts = ctx.cells.map((c) => c.text).join("\n");
    expect(ctx.cells.map((c) => c.cellId)).toContain("brand_promise");
    expect(ctx.cells.map((c) => c.cellId)).toContain("profit_per_x");
    expect(texts).toContain("Parents are our customer; we make their lives better first.");
    expect(texts).toContain("Payer: center");
    // Cells fed only by questions not in the fixture (Sandbox boundaries q9,
    // quarterly rocks q11, etc.) are blank and therefore omitted from the read.
    expect(ctx.cells.map((c) => c.cellId)).not.toContain("sandbox_boundaries");
    expect(ctx.cells.map((c) => c.cellId)).not.toContain("quarterly_rocks");
  });

  it("neutralises q14(b) teammate ids and strips any uuid token", () => {
    const withOthers = {
      q14: {
        value: { wants: ["product"], others: { [UUID]: "backend" }, hours: 30 },
        confidence: null,
      },
    } as OpspSourceAnswers;
    const ctx = buildOpspAnalysisContextFromCells(
      cellsOf(withOthers),
      "A",
      1,
    );
    const text = ctx.cells.map((c) => c.text).join("\n");
    expect(text).toContain(`Wants to own: product`);
    expect(text).toContain(`${OPSP_ANONYMISED_TEAMMATE_LABEL}: backend`);
    expect(text).not.toContain(UUID);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("redactRespondentIds strips a uuid from free-edited text", () => {
    expect(redactRespondentIds(`fix this for ${UUID}`)).toBe("fix this for [id]");
    expect(redactRespondentIds("no id here")).toBe("no id here");
  });
});

describe("the deterministic structural sibling (PR3)", () => {
  it("inventories filled/blank cells, their marks and provenance", () => {
    const cells = cellsOf(SELF_CONTRADICTING);
    const summary = buildOpspDeterministicSummary(cells, 1);

    expect(summary.draftVersion).toBe(1);
    expect(summary.cellCount).toBe(16);
    // purpose, bhag, three_year_targets, sandbox_core_customer, brand_promise,
    // profit_per_x, year1_critical_number are filled from this snapshot.
    expect(summary.filledCount).toBe(7);
    const purpose = summary.cells.find((c) => c.cellId === "purpose")!;
    expect(purpose.filled).toBe(true);
    expect(purpose.mark).toBe("ink");
    const rhyt = summary.cells.find((c) => c.cellId === "three_year_targets")!;
    expect(rhyt.mark).toBe("metric: ink; number: pencil");
    const empty = summary.cells.find((c) => c.cellId === "accountability_face")!;
    expect(empty.filled).toBe(false);
  });

  it("renders the mark label for parts and single marks", () => {
    expect(opspMarkLabel({ type: "single", mark: "pencil" })).toBe("pencil");
    expect(opspMarkLabel({ type: "single", mark: "ink" })).toBe("ink");
  });
});

describe("serveOpspAnalysis — the served level decides the response", () => {
  it("L0 serves a contradiction finding for the self-contradicting plan (acceptance 2)", async () => {
    const cells = cellsOf(SELF_CONTRADICTING);
    const body = await serveOpspAnalysis(
      gatewayCtx({ pin: "L0" }),
      providerReply(okOutput()),
      "pinned-model",
      "L0",
      "cohort:opsp:owner",
      () => Promise.resolve({ done: true, output: okOutput() }),
      draft(cells),
      "A",
    );

    if (body.level !== "L0") throw new Error("expected an L0 read");
    expect(body.ok).toBe(true);
    expect(body.analysis.contradictions.length).toBeGreaterThan(0);
    const contradiction = body.analysis.contradictions[0];
    expect(contradiction.between).toBe("brand_promise and profit_per_x");
    expect(contradiction.positions[0]).toContain("Parents are our customer");
    expect(body.analysis.unfalsifiableCells[0].cell).toBe("bhag");
    expect(body.analysis.consistentCells).toContain("purpose");
  });

  it("a healthy reply that does not parse as FR-33 output degrades to the structural sibling", async () => {
    const freeText: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: "the plan looks fine",
        inputTokens: 1,
        outputTokens: 1,
        model: "pinned-model",
      }),
    };
    const body = await serveOpspAnalysis(
      gatewayCtx({ pin: "L0" }),
      freeText,
      "pinned-model",
      "L0",
      "cohort:opsp:owner",
      () => Promise.resolve({ done: false, output: null }),
      draft(cellsOf(SELF_CONTRADICTING)),
      "A",
    );
    expect(body.level).toBe("L2");
    if (!("deterministic" in body)) throw new Error("expected a deterministic body");
    expect(body.deterministic.filledCount).toBe(7);
  });

  it("L2 (the key-removed default) returns the structural read, never an error (PR3)", async () => {
    const body = await serveOpspAnalysis(
      gatewayCtx({ pin: "L2" }),
      brokenProvider(),
      "pinned-model",
      "L2",
      "cohort:opsp:owner",
      () => Promise.resolve({ done: false, output: null }),
      draft(cellsOf(SELF_CONTRADICTING)),
      "A",
    );
    expect(body.level).toBe("L2");
    if (!("deterministic" in body)) throw new Error("expected a deterministic body");
    expect(body.ok).toBe(true);
    expect(body.deterministic.draftVersion).toBe(1);
    expect(getCompletedAnalysis("cohort:opsp:owner")).toBeUndefined();
  });

  it("L1 queues a background retry and returns queued plus the structural read", async () => {
    const output = okOutput();
    const jobKey = "cohort:opsp:owner";
    const body = await serveOpspAnalysis(
      gatewayCtx({ pin: "L1" }),
      providerReply(output),
      "pinned-model",
      "L1",
      jobKey,
      () => Promise.resolve({ done: true, output }),
      draft(cellsOf(SELF_CONTRADICTING)),
      "A",
    );
    expect(body.level).toBe("L1");
    if (body.level !== "L1" || !("deterministic" in body)) {
      throw new Error("expected an L1 structural body");
    }
    expect(body.queued).toBe(true);

    await drainAnalysisQueue();
    const queued = getCompletedAnalysis<OpspAnalysisOutput>(jobKey);
    expect(queued).toEqual(output);
  });
});

describe("every output is labelled and marked as prep material (FR-35)", () => {
  it("carries the pinned model, a generation timestamp and the prep label", async () => {
    const body = await serveOpspAnalysis(
      gatewayCtx({ pin: "L0" }),
      providerReply(okOutput()),
      "pinned-model",
      "L0",
      "cohort:opsp:owner",
      () => Promise.resolve({ done: true, output: okOutput() }),
      draft(cellsOf(SELF_CONTRADICTING)),
      "A",
    );
    expect(body.ok).toBe(true);
    expect(body.label.model).toBe("pinned-model");
    expect(body.label.generatedAt).toBeTruthy();
    expect(isNaN(Date.parse(body.label.generatedAt))).toBe(false);
    expect(body.prepLabel).toBe(ANALYSIS_PREP_LABEL);
  });

  it("is re-runnable: a second serve produces a fresh labelled read", async () => {
    const serve = () =>
      serveOpspAnalysis(
        gatewayCtx({ pin: "L0" }),
        providerReply(okOutput()),
        "pinned-model",
        "L0",
        "cohort:opsp:owner",
        () => Promise.resolve({ done: true, output: okOutput() }),
        draft(cellsOf(SELF_CONTRADICTING)),
        "A",
      );
    const first = await serve();
    const second = await serve();
    if (first.level !== "L0" || second.level !== "L0") throw new Error("expected L0 reads");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.label.generatedAt).toBeTruthy();
    expect(second.label.model).toBe(first.label.model);
  });
});