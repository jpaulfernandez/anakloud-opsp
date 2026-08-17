import { describe, expect, it } from "vitest";
import {
  buildOpspAnalysisMessages,
  MalformedOpspAnalysisOutputError,
  OPSP_ANALYSIS_RESULT_TOOL,
  OPSP_ANALYSIS_RESULT_TOOL_NAME,
  OPSP_ANALYSIS_SYSTEM_PROMPT,
  parseOpspAnalysisResponse,
  type OpspAnalysisOutput,
  type OpspAnalysisRequestContext,
} from "../../lib/opsp-analysis-prompt";

// F14-T04 — the individual-OPSP strengths/gaps read's pure prompt model. The
// acceptance criteria that are safe to assert without a browser, a database or
// a model:
//
//   - the system prompt keeps the FR-33 contract: report the three categories,
//     never rewrite a cell, never recommend a change, and frame the output as
//     facilitator prep;
//   - the output schema forces the three categories (consistent / contradicted /
//     unfalsifiable) so a read that skips one is structurally impossible;
//   - the standalone message builder renders cell titles and content in the
//     plan's own words and carries no identity.

function okOutput(): OpspAnalysisOutput {
  return {
    consistentCells: ["purpose", "bhag"],
    contradictions: [
      {
        between: "brand_promise and profit_per_x",
        positions: [
          "Parents are our customer; we make their lives better first.",
          "Payer: center; monthly subscription billed per center.",
        ],
      },
    ],
    unfalsifiableCells: [{ cell: "bhag", reason: "nothing could check it" }],
    readNote: "The plan names parents as the customer while the profit model bills centers.",
  };
}

function context(overrides: Partial<OpspAnalysisRequestContext> = {}): OpspAnalysisRequestContext {
  return {
    ownerLabel: "A",
    draftVersion: 1,
    cells: [
      {
        cellId: "brand_promise",
        title: "Brand Promise",
        text: "Parents are our customer; we make their lives better first.",
      },
      {
        cellId: "profit_per_x",
        title: "Profit per X",
        text: "Payer: center.\nModel: monthly_subscription.\nPays: 2500 per_center.",
      },
    ],
    ...overrides,
  };
}

describe("the system prompt keeps the FR-33 contract", () => {
  it("asks for the three categories in the plan's own words", () => {
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/internally consistent/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/contradict/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/unfalsifiable/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/plan's own words/i);
  });

  it("never asks the model to rewrite, fill a blank or recommend a change", () => {
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/do not rewrite it/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/do not fill\s+a blank/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/do not recommend/i);
    expect(OPSP_ANALYSIS_SYSTEM_PROMPT).toMatch(/prep material/i);
  });
});

describe("the output schema forces the three categories", () => {
  it("names the forced tool and requires all FR-33 fields", () => {
    expect(OPSP_ANALYSIS_RESULT_TOOL.name).toBe(OPSP_ANALYSIS_RESULT_TOOL_NAME);
    const props = OPSP_ANALYSIS_RESULT_TOOL.input_schema.properties;
    expect(props).toHaveProperty("consistentCells");
    expect(props).toHaveProperty("contradictions");
    expect(props).toHaveProperty("unfalsifiableCells");
    expect(props).toHaveProperty("readNote");
  });
});

describe("buildOpspAnalysisMessages", () => {
  it("renders each cell with its title and content, and no identity", () => {
    const messages = buildOpspAnalysisMessages(context());
    const turn = messages.messages[0].content;
    expect(turn).toContain("one founder's draft strategic plan (Draft 1)");
    expect(turn).toContain("Brand Promise (brand_promise):");
    expect(turn).toContain("Parents are our customer; we make their lives better first.");
    expect(turn).toContain("Profit per X (profit_per_x):");
    expect(turn).toContain("Payer: center.");
    // No email, id, cohort or respondent field rides in the user turn.
    expect(turn).not.toContain("@");
    expect(turn).not.toMatch(/\bemail\b/);
    expect(turn).not.toMatch(/\bcohortId\b|\bcohort_id\b|\brespondentId\b|\brespondent_id\b/);
  });
});

describe("parseOpspAnalysisResponse", () => {
  it("parses a forced tool-use block from a raw Messages body", () => {
    const output = okOutput();
    const body = {
      content: [{ type: "tool_use", name: OPSP_ANALYSIS_RESULT_TOOL_NAME, input: output }],
    };
    expect(parseOpspAnalysisResponse(body)).toEqual(output);
  });

  it("parses the serialized tool input a JSON provider returns", () => {
    expect(parseOpspAnalysisResponse(JSON.stringify(okOutput()))).toEqual(okOutput());
  });

  it("rejects a plain free-text reply with no tool call", () => {
    expect(() => parseOpspAnalysisResponse("looks consistent")).toThrow(
      MalformedOpspAnalysisOutputError,
    );
  });

  it("rejects a structured reply that omits a required FR-33 field", () => {
    const { contradictions, ...missing } = okOutput();
    expect(() => parseOpspAnalysisResponse({ content: [
      { type: "tool_use", name: OPSP_ANALYSIS_RESULT_TOOL_NAME, input: missing },
    ] })).toThrow(MalformedOpspAnalysisOutputError);
    expect(contradictions).toBeDefined();
  });

  it("rejects a contradiction without non-empty positions", () => {
    const bad = { ...okOutput(), contradictions: [{ between: "a and b", positions: [] }] };
    expect(() => parseOpspAnalysisResponse(JSON.stringify(bad))).toThrow(
      MalformedOpspAnalysisOutputError,
    );
  });
});