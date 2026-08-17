import { describe, expect, it } from "vitest";
import { buildOpspCells, OPSP_CELL_IDS, type OpspSourceAnswers } from "../../lib/opsp";
import { SEED_RESPONDENTS, type SeedAnswer } from "../../lib/seed";
import {
  OPSP_CELL_LABELS,
  formatOfficialCellProvenance,
  formatOpspCellValue,
  formatOpspProvenance,
  isOpspCellEmpty,
} from "../../lib/opsp-view";

// F07-T02 view-presentation pure functions (FR-23, ui_ux.md §4.14). These are
// the deterministic helpers the OPSP grid draws from: one title per cell, the
// "from Q3, Q4" provenance line, and a readable text rendering of a derived
// cell value. Nothing here invents content — a cell's text comes only from the
// fragments the mapping (F07-T01) derived from the respondent's own answers.

/** Build the snapshot shape from a §3.1 answer list, as opsp.test.ts does. */
function snapshotFrom(answers: ReadonlyArray<SeedAnswer>): OpspSourceAnswers {
  const snapshot: OpspSourceAnswers = {};
  for (const a of answers) {
    snapshot[a.question_id] = { value: a.value, confidence: a.confidence ?? null };
  }
  return snapshot;
}

describe("F07-T02 OPSP view helpers", () => {
  it("gives exactly one title per cell and no extra titles", () => {
    expect(Object.keys(OPSP_CELL_LABELS).sort()).toEqual([...OPSP_CELL_IDS].sort());
    expect(Object.keys(OPSP_CELL_LABELS)).toHaveLength(16);
    for (const id of OPSP_CELL_IDS) {
      const title = OPSP_CELL_LABELS[id].trim();
      expect(title.length).toBeGreaterThan(0);
    }
  });

  it("formats a provenance line from a cell's source questions", () => {
    expect(formatOpspProvenance(["q3"])).toBe("from Q3");
    expect(formatOpspProvenance(["q1", "q2"])).toBe("from Q1, Q2");
    expect(formatOpspProvenance(["q10", "q3"])).toBe("from Q10, Q3");
  });

  it("formats an accepted official cell's provenance from respondents' answers (F15-T06)", () => {
    // The official canvas provenance names respondents, not just questions:
    // "from Ern (Q7), Paul (Q7)" — the answer that fed the cell and its source
    // question, the shape FR-41 and ui_ux.md §4.20 want.
    expect(
      formatOfficialCellProvenance([
        { respondentId: "r-ern", respondentName: "Ern", questionId: "q7" },
        { respondentId: "r-paul", respondentName: "Paul", questionId: "q7" },
      ]),
    ).toBe("from Ern (Q7), Paul (Q7)");
    // A single respondent, and a one-digit vs two-digit question id, both label.
    expect(
      formatOfficialCellProvenance([
        { respondentId: "r-ana", respondentName: "Ana", questionId: "q10" },
      ]),
    ).toBe("from Ana (Q10)");
    // An empty provenance renders no line.
    expect(formatOfficialCellProvenance([])).toBe("from ");
  });

  it("treats a null or undefined value as an empty cell", () => {
    expect(isOpspCellEmpty({ value: null })).toBe(true);
    expect(isOpspCellEmpty({ value: undefined })).toBe(true);
    expect(isOpspCellEmpty({ value: { q1: { text: "x" } } })).toBe(false);
  });

  it("formats an edited cell's plain text verbatim (F07-T05)", () => {
    // An OPSP edit stores the respondent's own rewritten text as a string;
    // the renderer returns it unchanged rather than re-deriving or inventing.
    expect(formatOpspCellValue("Our purpose now.")).toBe("Our purpose now.");
    expect(formatOpspCellValue("")).toBe("");
  });

  it("formats a multi-source purpose cell from its fragments", () => {
    const purpose = {
      q1: { text: "Waiting stops being the reason a child misses care." },
      q2: {
        who: "families waiting on a diagnosis",
        because: "they would go back to rebuilding schedules by hand.",
      },
    };
    const text = formatOpspCellValue(purpose);
    expect(text).toContain("Waiting stops being the reason a child misses care.");
    expect(text).toContain(
      "The people who would miss it most are families waiting on a diagnosis, because they would go back to rebuilding schedules by hand.",
    );
  });

  it("formats the 3-Year Targets metric fragment", () => {
    const targets = { q3: { metric: "paying therapy centers", value: 500, unit: "per year" } };
    expect(formatOpspCellValue(targets)).toBe("paying therapy centers: 500 per year");
  });

  it("formats The #1 Priority's single star-marked rock", () => {
    const rock = { q11: { what: "Onboard beta centers", done_when: "8 centers" } };
    const text = formatOpspCellValue(rock);
    expect(text).toBe("Onboard beta centers — done when: 8 centers");
  });

  it("formats Quarterly Rocks' rocks array", () => {
    const rocks = {
      q11: {
        rocks: [
          { what: "Onboard beta centers", done_when: "8 centers" },
          { what: "Ship the live record", done_when: "one clinic" },
        ],
      },
    };
    const text = formatOpspCellValue(rocks);
    expect(text).toContain("1. Onboard beta centers — done when: 8 centers");
    expect(text).toContain("2. Ship the live record — done when: one clinic");
  });

  it("formats Q14 capacity (the hours fragment)", () => {
    const capacity = { q14: { hours: 12 } };
    expect(formatOpspCellValue(capacity)).toBe("Hours a week: 12");
  });

  it("formats Q14 accountability with roster-name resolution for others", () => {
    const accountability = {
      q14: { wants: ["product"], others: { maya_id: "backend" } },
    };
    const named = formatOpspCellValue(accountability, (rid) =>
      rid === "maya_id" ? "Maya" : undefined,
    );
    expect(named).toContain("Wants to own: product");
    expect(named).toContain("Maya: backend");
  });

  it("every non-empty cell in the seeded six formats to non-empty text", () => {
    for (const respondent of SEED_RESPONDENTS) {
      const cells = buildOpspCells(snapshotFrom(respondent.answers));
      for (const id of OPSP_CELL_IDS) {
        const cell = cells[id];
        const empty = isOpspCellEmpty(cell);
        const rendered = formatOpspCellValue(cell.value);
        if (empty) {
          // An empty cell renders nothing — it must not be auto-filled.
          expect(rendered).toBe("");
        } else {
          expect(rendered.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});