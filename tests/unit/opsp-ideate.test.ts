import { describe, expect, it } from "vitest";
import {
  CELL_REGISTRY_MAP,
  getSurveyAnswersForCell,
} from "../../lib/opsp-seed";
import {
  formatIdeateUserMessage,
  staticCellIdeation,
  IDEATE_SYSTEM_PROMPT,
  IDEATE_TOOL_SCHEMA,
} from "../../lib/opsp-ideate-prompt";

describe("AI Cell Ideation Prompt & Fallback", () => {
  it("formats user message with cell definition and stacked survey answers", () => {
    const cellDef = CELL_REGISTRY_MAP["T35-5"];
    const answers = getSurveyAnswersForCell("T35-5");
    const currentContent = ["PedConnect (1st)"];

    const msg = formatIdeateUserMessage(cellDef, currentContent, answers);

    expect(msg).toContain("Cell: T35-5 — Key thrusts / capabilities");
    expect(msg).toContain("Ana Reyes");
    expect(msg).toContain("PedConnect");
    expect(msg).toContain("Diego Tan");
    expect(msg).toContain("TeachDay");
  });

  it("produces rich static ideation annotations when survey answers are present", () => {
    const cellDef = CELL_REGISTRY_MAP["PU-1"];
    const answers = getSurveyAnswersForCell("PU-1");

    const result = staticCellIdeation(cellDef, answers);

    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.themes.length).toBeGreaterThan(0);
    expect(result.tensions.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("produces clean fallback annotations when a cell has no survey answers", () => {
    const cellDef = CELL_REGISTRY_MAP["SWT-1"];
    const result = staticCellIdeation(cellDef, []);

    expect(result.summary).toContain("not fed directly by baseline survey answers");
    expect(result.themes.length).toBeGreaterThan(0);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("validates IDEATE_TOOL_SCHEMA and system prompt structure", () => {
    expect(IDEATE_SYSTEM_PROMPT).toContain("OPSP");
    expect(IDEATE_TOOL_SCHEMA.name).toBe("cell_ideation_result");
    expect(IDEATE_TOOL_SCHEMA.input_schema.required).toEqual([
      "summary",
      "themes",
      "tensions",
      "suggestions",
    ]);
  });
});
