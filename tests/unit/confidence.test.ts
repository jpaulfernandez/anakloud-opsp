import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_QUESTION_IDS,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  CONFIDENCE_REQUIRED_MESSAGE,
  clampConfidence,
  confidenceIsSet,
  isConfidenceQuestion,
} from "../../lib/confidence";
import { QUESTION_IDS, QUESTION_MAP } from "../../lib/questions";

// F03-T11 confidence slider helpers, verified without a database. The registry
// already pins the FR-11 set on the question definitions (F01-T07); what this
// module owns is the 1..5 range, the question-id list the shell and component
// key on, and the "is it set yet" decision — all deterministic, so they are
// unit-tested here and the shell's forward-navigation rule stays pure.

const flagged = QUESTION_IDS.filter((id) => QUESTION_MAP[id].confidence).sort();

describe("confidence slider (F03-T11, FR-11)", () => {
  it("the confidence set is exactly the six FR-11 questions", () => {
    // "appears on exactly six questions, asserted against the registry" — the
    // ticket's acceptance, pinned so the component list can never drift from
    // the requirement.
    expect([...CONFIDENCE_QUESTION_IDS].sort()).toEqual(flagged);
    expect(flagged).toEqual(["q10", "q11", "q3", "q4", "q7", "q8"].sort());
  });

  it("every confidence question carries the confidence_slider input type, and only those do", () => {
    for (const id of QUESTION_IDS) {
      const hasSlider = (QUESTION_MAP[id].inputTypes as readonly string[]).includes(
        "confidence_slider",
      );
      expect(hasSlider).toBe(QUESTION_MAP[id].confidence);
      expect(hasSlider).toBe(isConfidenceQuestion(id));
    }
  });

  it("no other question is confidence-bearing", () => {
    for (const id of QUESTION_IDS) {
      if ((CONFIDENCE_QUESTION_IDS as readonly string[]).includes(id)) continue;
      expect(QUESTION_MAP[id].confidence, `${id} must not carry a slider`).toBe(
        false,
      );
    }
  });

  it("the range is 1..5", () => {
    expect(CONFIDENCE_MIN).toBe(1);
    expect(CONFIDENCE_MAX).toBe(5);
    expect(CONFIDENCE_MAX).toBeGreaterThan(CONFIDENCE_MIN);
  });

  it("confidenceIsSet accepts only a real 1..5 value, never unset or out of range", () => {
    expect(confidenceIsSet(null)).toBe(false);
    for (let n = 0; n <= 6; n++) {
      expect(confidenceIsSet(n)).toBe(n >= CONFIDENCE_MIN && n <= CONFIDENCE_MAX);
    }
  });

  it("clampConfidence keeps a numeric entry on the 1..5 range and rounds to a stop", () => {
    expect(clampConfidence(-3)).toBe(CONFIDENCE_MIN);
    expect(clampConfidence(9)).toBe(CONFIDENCE_MAX);
    expect(clampConfidence(2.4)).toBe(2);
    expect(clampConfidence(3.7)).toBe(4);
    expect(clampConfidence(3)).toBe(3);
  });

  it("the required message reads as an explanation, not a disabled state", () => {
    expect(CONFIDENCE_REQUIRED_MESSAGE.length).toBeGreaterThan(0);
  });
});