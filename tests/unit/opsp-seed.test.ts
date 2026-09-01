import { describe, expect, it } from "vitest";
import {
  CELL_REGISTRY,
  CELL_REGISTRY_MAP,
  INITIAL_PLAN_VALUES,
  SURVEY_ANSWERS,
  FACILITATOR_NOTES,
  getFacilitatorNotesForMode,
  getSurveyAnswersForCell,
  COLUMN_ORDER,
} from "../../lib/opsp-seed";

describe("OPSP Seed Registry (§2)", () => {
  it("contains exactly 32 cells in stable document order", () => {
    expect(CELL_REGISTRY.length).toBe(32);

    const expectedIds = [
      "SWT-1", "SWT-2", "SWT-3",
      "CV",
      "PU-1", "PU-2",
      "T35-1", "T35-2", "T35-3", "T35-3b", "T35-4", "T35-5", "T35-6",
      "G1-1", "G1-2", "G1-3", "G1-4", "G1-5",
      "A90-1", "A90-2", "A90-3", "A90-4", "A90-5",
      "TH-1", "TH-2", "TH-3", "TH-4", "TH-5", "TH-6", "TH-7",
      "AC-1", "AC-2",
    ];

    expect(CELL_REGISTRY.map((c) => c.id)).toEqual(expectedIds);
  });

  it("assigns valid columns from COLUMN_ORDER to every cell", () => {
    for (const def of CELL_REGISTRY) {
      expect(COLUMN_ORDER).toContain(def.column);
      expect(def.label.length).toBeGreaterThan(0);
      expect(["text", "list", "metrics", "date", "table", "pair"]).toContain(def.kind);
    }
  });

  it("configures table and metrics cells with appropriate columns and rowLabels", () => {
    expect(CELL_REGISTRY_MAP["CV"].columns).toEqual(["Value", "We do", "We don't"]);
    expect(CELL_REGISTRY_MAP["T35-2"].rowLabels).toEqual([
      "Paying centers", "Active children", "MRR", "Team size",
    ]);
    expect(CELL_REGISTRY_MAP["T35-4"].columns).toEqual(["Promise", "KPI"]);
    expect(CELL_REGISTRY_MAP["A90-3"].columns).toEqual([
      "Rock", "Owner", "Done-definition", "Hrs/wk",
    ]);
    expect(CELL_REGISTRY_MAP["AC-1"].columns).toEqual(["Person", "KPI 1", "KPI 2"]);
  });

  it("provides initial plan values for all cells", () => {
    for (const def of CELL_REGISTRY) {
      expect(INITIAL_PLAN_VALUES[def.id]).toBeDefined();
    }
  });

  it("contains survey answers for source-question linked cells", () => {
    expect(SURVEY_ANSWERS.length).toBeGreaterThan(0);
    const cellsWithSources = CELL_REGISTRY.filter((c) => Boolean(c.sourceQuestion));
    expect(cellsWithSources.length).toBeGreaterThan(0);

    for (const def of cellsWithSources) {
      const answers = getSurveyAnswersForCell(def.id);
      expect(answers.length).toBeGreaterThan(0);
      for (const a of answers) {
        expect(a.person.length).toBeGreaterThan(0);
        expect(a.answer.length).toBeGreaterThan(0);
      }
    }
  });

  it("contains survey answers with confidence ratings for confidence questions", () => {
    const t35_2 = getSurveyAnswersForCell("T35-2");
    expect(t35_2.length).toBe(6);
    expect(t35_2.every((a) => typeof a.confidence === "number")).toBe(true);

    const pu_2 = getSurveyAnswersForCell("PU-2");
    expect(pu_2.length).toBe(6);
    expect(pu_2.every((a) => typeof a.confidence === "number")).toBe(true);

    const t35_5 = getSurveyAnswersForCell("T35-5");
    expect(t35_5.length).toBe(6);
    expect(t35_5.every((a) => typeof a.confidence === "number")).toBe(true);
  });
});

describe("Audience Mode Gating (§5)", () => {
  it("returns facilitator notes when mode is facilitator", () => {
    const notes = getFacilitatorNotesForMode("SWT-2", "facilitator");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes[0].body).toContain("pre-mortem");
  });

  it("returns an empty array when mode is room (hard security gate)", () => {
    const notes = getFacilitatorNotesForMode("SWT-2", "room");
    expect(notes).toEqual([]);

    for (const note of FACILITATOR_NOTES) {
      expect(getFacilitatorNotesForMode(note.cellId, "room")).toEqual([]);
    }
  });
});
