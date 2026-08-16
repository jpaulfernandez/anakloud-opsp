import { describe, expect, it } from "vitest";
import {
  APP_LABELS,
  rankingIsAnswered,
  shufflePool,
  toRankingValue,
} from "../../lib/ranking";
import {
  APP_IDS,
  RANKING_QUESTION_IDS,
  QUESTIONS,
  type AppId,
  type Q8Value,
} from "../../lib/questions";

// Pure tap-to-assign ranking helpers (F03-T07, ui_ux.md §4.7,
// anakloud-baseline-questions.md Q8). The pool permutation, the app labels and
// the "answered" rule are deterministic behaviour the shell's forward-
// navigation depends on, so they are verified without a browser. Two properties
// matter most: the pool order must be a *per-respondent permutation* (a fixed
// order is itself an anchor — AGENTS.md rule 1), and the question is only an
// answer once the order, the delete choice, the why and the prediction are all
// present.

function fullDraft(): {
  rank: AppId[];
  delete: AppId;
  why: string;
  predicted: AppId[];
} {
  return {
    rank: ["pedconnect", "teachday", "parentup", "fourth_app"],
    delete: "fourth_app",
    why: "it's the one nobody reaches for",
    predicted: ["teachday", "pedconnect", "parentup", "fourth_app"],
  };
}

describe("shufflePool", () => {
  it("is a permutation of all four apps for a given seed", () => {
    const order = shufflePool("some-respondent-id");
    expect(order).toHaveLength(APP_IDS.length);
    expect([...order].sort()).toEqual([...APP_IDS].sort());
  });

  it("is deterministic for the same seed", () => {
    expect(shufflePool("respondent-a")).toEqual(shufflePool("respondent-a"));
  });

  it("differs between two respondents in the same cohort — the pool is not a fixed default", () => {
    // ui_ux §4.7: "Card order in the pool is randomised per respondent — a
    // fixed order subtly signals a default ranking."
    expect(shufflePool("respondent-a")).not.toEqual(
      shufflePool("respondent-b"),
    );
  });

  it("derives a different prediction pool from the same respondent", () => {
    // The predict-the-group ranking is a separate, independent ordering; it
    // must not simply mirror the main pool's idle order.
    expect(shufflePool("respondent-a")).not.toEqual(
      shufflePool("respondent-a:predicted"),
    );
  });
});

describe("APP_LABELS", () => {
  it("labels every registered app id", () => {
    expect(Object.keys(APP_LABELS)).toHaveLength(APP_IDS.length);
    for (const id of APP_IDS) {
      expect(APP_LABELS[id]).toMatch(/\S/);
    }
    expect(APP_LABELS.pedconnect).toBe("PedConnect");
    expect(APP_LABELS.teachday).toBe("TeachDay");
    expect(APP_LABELS.parentup).toBe("ParentUp");
  });
});

describe("rankingIsAnswered", () => {
  it("is answered only with a full order, a delete, a why and a prediction", () => {
    expect(rankingIsAnswered(fullDraft())).toBe(true);
  });

  it("is unanswered while the order is incomplete", () => {
    expect(
      rankingIsAnswered({ ...fullDraft(), rank: ["pedconnect", "teachday"] }),
    ).toBe(false);
  });

  it("is unanswered while no delete is chosen", () => {
    expect(
      rankingIsAnswered({ ...fullDraft(), delete: null }),
    ).toBe(false);
  });

  it("is unanswered with an empty why", () => {
    expect(rankingIsAnswered({ ...fullDraft(), why: "" })).toBe(false);
    expect(rankingIsAnswered({ ...fullDraft(), why: "   " })).toBe(false);
  });

  it("is unanswered while the prediction is incomplete", () => {
    expect(
      rankingIsAnswered({ ...fullDraft(), predicted: ["teachday"] }),
    ).toBe(false);
  });
});

describe("toRankingValue", () => {
  it("maps an answered draft onto the §3.1 stored shape", () => {
    const draft = fullDraft();
    const value: Q8Value = toRankingValue(draft);
    expect(value).toEqual({
      rank: draft.rank,
      delete: draft.delete,
      why: draft.why,
      predicted: draft.predicted,
    });
  });

  it("refuses to map a draft with no delete chosen", () => {
    expect(() => toRankingValue({ ...fullDraft(), delete: null })).toThrow();
  });
});

describe("registry wiring", () => {
  it("registers Q8 as a required ranking question", () => {
    const q8 = QUESTIONS.find((q) => q.id === "q8");
    expect(q8?.inputTypes).toContain("ranking");
    expect(q8?.required).toBe(true);
    // Exactly the one question this input belongs to.
    expect(RANKING_QUESTION_IDS).toEqual(["q8"]);
  });
});