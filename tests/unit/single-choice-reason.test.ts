import { describe, expect, it } from "vitest";
import {
  SINGLE_CHOICE_REASON_BLOCKED_MESSAGE,
  Q6_CHOICE_LABELS,
  singleChoiceReasonIsAnswered,
  toSingleChoiceReasonValue,
} from "../../lib/single-choice-reason";
import { REQUIRED_UNANSWERED_MESSAGE } from "../../lib/navigation";
import {
  Q6_CHOICES,
  SINGLE_CHOICE_REASON_QUESTION_IDS,
  QUESTIONS,
} from "../../lib/questions";

// Pure single-choice + required-reason helpers (F03-T06, ui_ux.md §4.9,
// anakloud-baseline-questions.md Q6). The "is answered" rule — both a chosen
// party and a non-blank reason — is deterministic behaviour the shell's
// forward-navigation depends on, so it is verified without a browser. Q6 is
// "the tiebreak", the sharpest question in the set: "do not let them submit a
// bare choice" (baseline Q6), so a choice with no reason must not read as an
// answer.

describe("singleChoiceReasonIsAnswered", () => {
  it("requires both a chosen party and a non-blank reason", () => {
    expect(
      singleChoiceReasonIsAnswered({
        choice: "center",
        why: "they pay, and if they churn there is no data for the parent",
      }),
    ).toBe(true);
  });

  it("is unanswered while no party is chosen", () => {
    expect(
      singleChoiceReasonIsAnswered({ choice: null, why: "still deciding" }),
    ).toBe(false);
  });

  it("is unanswered with a bare choice and no reason — the whole point of Q6", () => {
    // "do not let them submit a bare choice" (baseline Q6).
    expect(singleChoiceReasonIsAnswered({ choice: "parent", why: "" })).toBe(
      false,
    );
    expect(singleChoiceReasonIsAnswered({ choice: "pedia", why: "   " })).toBe(
      false,
    );
  });
});

describe("SINGLE_CHOICE_REASON_BLOCKED_MESSAGE", () => {
  it("is the exact line ui_ux §4.9 names", () => {
    expect(SINGLE_CHOICE_REASON_BLOCKED_MESSAGE).toBe("Add a line about why");
  });

  it("replaces the generic unanswered line rather than reusing it", () => {
    // The ticket: "replace the generic blocked state with the line …".
    expect(SINGLE_CHOICE_REASON_BLOCKED_MESSAGE).not.toBe(
      REQUIRED_UNANSWERED_MESSAGE,
    );
  });
});

describe("Q6_CHOICE_LABELS", () => {
  it("labels all four options from the baseline", () => {
    // The four parties are explicitly answered (center / parent / pediatrician
    // / therapist) — "we serve everyone" is not an available answer.
    expect(Q6_CHOICES).toEqual(["center", "parent", "pedia", "therapist"]);
    expect(Object.keys(Q6_CHOICE_LABELS)).toHaveLength(4);
    for (const choice of Q6_CHOICES) {
      expect(Q6_CHOICE_LABELS[choice]).toMatch(/\S/);
    }
  });
});

describe("toSingleChoiceReasonValue", () => {
  it("maps an answered draft onto the §3.1 stored shape", () => {
    // The answer persists as `{ choice, why }` (F03-T06).
    expect(
      toSingleChoiceReasonValue({ choice: "therapist", why: "the front lines" }),
    ).toEqual({ choice: "therapist", why: "the front lines" });
  });

  it("refuses to map an unanswered draft", () => {
    expect(() =>
      toSingleChoiceReasonValue({ choice: null, why: "nope" }),
    ).toThrow();
  });
});

describe("registry wiring", () => {
  it("registers Q6 as a single-choice-reason question that is required", () => {
    const q6 = QUESTIONS.find((q) => q.id === "q6");
    expect(q6?.inputTypes).toContain("single_choice_reason");
    expect(q6?.required).toBe(true);
    // Exactly the one question this input belongs to.
    expect(SINGLE_CHOICE_REASON_QUESTION_IDS).toEqual(["q6"]);
  });
});