import { describe, expect, it } from "vitest";
import {
  buildOpspCells,
  OPSP_CELL_IDS,
  type OpspCellId,
  type OpspSourceAnswers,
  type OpspCell,
} from "../../lib/opsp";
import {
  SEED_RESPONDENTS,
  type SeedAnswer,
  type SeedAnswerValue,
} from "../../lib/seed";

// F07-T01 deterministic OPSP mapping — pure, no I/O, no AI. The mapping is the
// whole product returning to the respondent (FR-22): sixteen cells derived only
// from their own answers, ink where they are confident and complete, pencil for
// the pre-beta guesses and anything low-confidence, blank where they said
// nothing. These tests pin exactly that.

/** The snapshot shape buildOpspCells consumes, built from a §3.1 answer list. */
function snapshotFrom(answers: ReadonlyArray<SeedAnswer>): OpspSourceAnswers {
  const snapshot: OpspSourceAnswers = {};
  for (const a of answers) {
    snapshot[a.question_id] = { value: a.value, confidence: a.confidence ?? null };
  }
  return snapshot;
}

/** Build one answer entry, as the seed answers are shaped. */
function answer(
  question_id: string,
  value: SeedAnswerValue,
  confidence?: number,
): SeedAnswer {
  return confidence === undefined
    ? { question_id, value }
    : { question_id, value, confidence };
}

/** A helper that types the pencil means the whole default-pencil set. */
function singleMark(cell: OpspCell, mark: "ink" | "pencil"): void {
  expect(cell.marking).toEqual({ type: "single", mark });
}

describe("F07-T01 OPSP mapping", () => {
  it("produces exactly the sixteen Part B cells and no seventeenth", () => {
    const cells = buildOpspCells(snapshotFrom(SEED_RESPONDENTS[0].answers));
    expect(Object.keys(cells).sort()).toEqual([...OPSP_CELL_IDS].sort());
    expect(Object.keys(cells)).toHaveLength(16);

    // Every cell records which questions fed it.
    for (const id of OPSP_CELL_IDS) {
      const cell = cells[id];
      expect(Array.isArray(cell.sources)).toBe(true);
      expect(cell.sources.length).toBeGreaterThan(0);
      for (const q of cell.sources) {
        expect(q).toMatch(/^q(1[0-5]|[1-9])$/);
      }
    }
  });

  it("maps the seeded six deterministically across runs (golden file)", () => {
    const golden: Record<string, Record<OpspCellId, OpspCell>> = {};
    for (const respondent of SEED_RESPONDENTS) {
      golden[respondent.display_name] = buildOpspCells(
        snapshotFrom(respondent.answers),
      );
    }
    expect(golden).toMatchSnapshot();
  });

  it("is deterministic: identical answers produce identical cells", () => {
    const answers = SEED_RESPONDENTS[0].answers as readonly SeedAnswer[];
    const snapshot = snapshotFrom(answers);
    expect(buildOpspCells(snapshot)).toEqual(buildOpspCells(snapshot));
  });

  it("defaults BHAG, Brand Promise, Profit per X and 1-Year Critical Number to pencil at high confidence", () => {
    const high: OpspSourceAnswers = {
      q3: {
        value: { metric: "paying centers", value: 300, unit: "centers", why: "adoption" },
        confidence: 5,
      },
      q4: { value: { text: "Every child identified by five." }, confidence: 5 },
      q7: { value: { text: "the one live progress record." }, confidence: 5 },
      q10: {
        value: {
          payer: "center",
          model: "monthly",
          amount: 2500,
          unit: "per_center",
          first_peso: "2027-01",
        },
        confidence: 5,
      },
    };
    const cells = buildOpspCells(high);
    singleMark(cells.bhag, "pencil");
    singleMark(cells.brand_promise, "pencil");
    singleMark(cells.profit_per_x, "pencil");
    singleMark(cells.year1_critical_number, "pencil");
  });

  it("renders 3-Year Targets with a mixed mark: ink metric, pencil number", () => {
    const high: OpspSourceAnswers = {
      q3: {
        value: { metric: "paying therapy centers", value: 500, unit: "per year", why: "adoption" },
        confidence: 5,
      },
    };
    const cells = buildOpspCells(high);
    expect(cells.three_year_targets.marking).toEqual({
      type: "parts",
      parts: [
        { key: "metric", mark: "ink" },
        { key: "number", mark: "pencil" },
      ],
    });
  });

  it("renders 3-Year Targets all-pencil when Q3 carries low confidence", () => {
    const low: OpspSourceAnswers = {
      q3: {
        value: { metric: "paying therapy centers", value: 500, unit: "per year", why: "adoption" },
        confidence: 1,
      },
    };
    const cells = buildOpspCells(low);
    expect(cells.three_year_targets.marking).toEqual({
      type: "parts",
      parts: [
        { key: "metric", mark: "pencil" },
        { key: "number", mark: "pencil" },
      ],
    });
  });

  it("bumps an ink-default cell to pencil when a feeding answer is low-confidence", () => {
    const low: OpspSourceAnswers = {
      q11: {
        value: {
          rocks: [
            { what: "Onboard beta centers", done_when: "8 centers" },
          ],
          starred: 0,
        },
        confidence: 1,
      },
    };
    const cells = buildOpspCells(low);
    singleMark(cells.quarterly_rocks, "pencil");
    singleMark(cells.number1_priority, "pencil");
  });

  it("leaves an optional cell empty (null value, pencil) and never fills it", () => {
    // Q15 is the one optional question (Part D can cut it); a full answer set
    // without it must produce a blank Core Values cell, not plausible filler.
    const allButOptional = snapshotFrom(
      SEED_RESPONDENTS[0].answers.filter((a) => a.question_id !== "q15"),
    );
    const cells = buildOpspCells(allButOptional);
    expect(cells.core_values.value).toBeNull();
    singleMark(cells.core_values, "pencil");
  });

  it("keeps a multi-source cell populated when only some sources are present", () => {
    const partial: OpspSourceAnswers = {
      q1: { value: { text: "Waiting stops being the reason a child misses care." }, confidence: null },
      // q2 absent — but the cell still holds what Q1 contributes.
    };
    const cells = buildOpspCells(partial);
    expect(cells.purpose.value).toEqual({
      q1: { text: "Waiting stops being the reason a child misses care." },
    });
    // Non-empty and Q1 carries no confidence slider, so the cell stays ink.
    singleMark(cells.purpose, "ink");
  });
});