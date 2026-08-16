import { describe, expect, it } from "vitest";
import {
  isQuestionId,
  isValidAnswerShape,
  parseAnswerWriteBody,
} from "../../lib/answer-shape";
import { QUESTION_IDS, type QuestionId } from "../../lib/questions";

// Pure shape validation for the answers API (F04-T01, tech_infrastructure.md
// §3.1). The route rejects wrong-shaped answer payloads with 400 before
// writing; every one of the fifteen §3.1 shapes is asserted here so the
// guarantee holds exhaustively rather than for the questions someone happened
// to write a test for.

/** A structurally valid §3.1 answer value per question. */
const VALID: Record<QuestionId, unknown> = {
  q1: { text: "Because kids fall through the gaps today." },
  q2: { who: "the therapy centers", because: "they have no records at all" },
  q3: { metric: "centers on the platform", value: 50, unit: "centers", why: "revenue follows adoption" },
  q4: { text: "One in three Filipino kids has their care coordinated by Anakloud." },
  q5: { pays: ["parent"], decides: ["center_owner"], uses: ["pediatrician"], benefits: ["child"] },
  q6: { choice: "center", why: "one good center keeps a hundred kids moving" },
  q7: { text: "we keep the whole team on one plan of care" },
  q8: { rank: ["pedconnect", "teachday"], delete: "parentup", why: "parents are the gate", predicted: ["teachday", "pedconnect"] },
  q9: { items: ["no hardware", "no overseas expansion", "no consumer app"] },
  q10: { payer: "center", model: "monthly subscription per center", amount: 2500, unit: "pesos/center/mo", first_peso: "2026-11" },
  q11: { rocks: [{ what: "Ship beta", done_when: "30 Nov 2026" }], starred: 1 },
  q12: { text: "Open doors" },
  q13: { text: "We ran out of money.", cause: "ran out of money" },
  q14: { wants: ["product", "backend"], others: { "t-1": "finance" }, hours: 20, private_note: "I may need to step back." },
  q15: { text: "Ben rebuilt the demo overnight." },
};

describe("isValidAnswerShape", () => {
  it("accepts a structurally valid value for every one of the fifteen questions", () => {
    for (const id of QUESTION_IDS) {
      expect(isValidAnswerShape(id, VALID[id]), `q for ${id}`).toBe(true);
    }
  });

  it("rejects a missing required key for each question", () => {
    const withoutText = (id: "q1" | "q4" | "q7" | "q12" | "q15") => {
      const copy = { ...(VALID[id] as Record<string, unknown>) };
      delete copy.text;
      return copy;
    };
    for (const id of ["q1", "q4", "q7", "q12", "q15"] as const) {
      expect(isValidAnswerShape(id, withoutText(id)), `${id} without text`).toBe(false);
    }

    const q3noMetric = { ...(VALID.q3 as Record<string, unknown>) };
    delete q3noMetric.metric;
    expect(isValidAnswerShape("q3", q3noMetric)).toBe(false);

    const q5noPays = { ...(VALID.q5 as Record<string, unknown>) };
    delete q5noPays.pays;
    expect(isValidAnswerShape("q5", q5noPays)).toBe(false);

    const q11noRocks = { ...(VALID.q11 as Record<string, unknown>) };
    delete q11noRocks.rocks;
    expect(isValidAnswerShape("q11", q11noRocks)).toBe(false);

    const q14noWants = { ...(VALID.q14 as Record<string, unknown>) };
    delete q14noWants.wants;
    expect(isValidAnswerShape("q14", q14noWants)).toBe(false);
  });

  it("rejects a mistyped value for each question", () => {
    expect(isValidAnswerShape("q1", { text: 42 })).toBe(false);
    expect(isValidAnswerShape("q2", { who: 1, because: "x" })).toBe(false);
    expect(isValidAnswerShape("q3", { metric: "m", value: "not a number", unit: "u", why: "w" })).toBe(false);
    expect(isValidAnswerShape("q5", { pays: "not-array", decides: [], uses: [], benefits: [] })).toBe(false);
    expect(isValidAnswerShape("q6", { choice: "center", why: 3 })).toBe(false);
    expect(isValidAnswerShape("q8", { rank: ["a"], delete: "b", why: "c", predicted: 7 })).toBe(false);
    expect(isValidAnswerShape("q9", { items: ["one", "two"] })).toBe(false);
    expect(isValidAnswerShape("q10", { payer: "p", model: "m", amount: "lots", unit: "u", first_peso: "2026-11" })).toBe(false);
    expect(isValidAnswerShape("q11", { rocks: [{ what: "x", done_when: "y" }], starred: 9 })).toBe(false);
    expect(isValidAnswerShape("q13", { text: "t", cause: 5 })).toBe(false);
    expect(isValidAnswerShape("q14", { wants: ["product"], others: { id: 1 }, hours: 20, private_note: "" })).toBe(false);
  });

  it("rejects non-object values and array values everywhere", () => {
    for (const id of QUESTION_IDS) {
      expect(isValidAnswerShape(id, null), `null for ${id}`).toBe(false);
      expect(isValidAnswerShape(id, "text"), `string for ${id}`).toBe(false);
      expect(isValidAnswerShape(id, ["rank"]), `array for ${id}`).toBe(false);
    }
  });

  it("requires q9 items to be exactly three strings", () => {
    expect(isValidAnswerShape("q9", { items: ["a", "b", "c"] })).toBe(true);
    expect(isValidAnswerShape("q9", { items: ["a", "b"] })).toBe(false);
    expect(isValidAnswerShape("q9", { items: ["a", "b", "c", "d"] })).toBe(false);
  });
});

describe("isQuestionId", () => {
  it("accepts only the fifteen stable ids", () => {
    for (const id of QUESTION_IDS) expect(isQuestionId(id)).toBe(true);
    for (const bad of ["q0", "q16", "question-7", "Q1", "", 7]) {
      expect(isQuestionId(bad)).toBe(false);
    }
  });
});

describe("parseAnswerWriteBody", () => {
  it("parses a valid body, ignoring a client-supplied respondent_id", () => {
    const parsed = parseAnswerWriteBody({
      question_id: "q7",
      value: { text: "one priority" },
      respondent_id: "55555555-5555-5555-5555-555555555555",
      confidence: 4,
    });
    expect(parsed).toEqual({
      questionId: "q7",
      value: { text: "one priority" },
      confidence: 4,
    });
  });

  it("returns null for a non-object body", () => {
    expect(parseAnswerWriteBody(null)).toBeNull();
    expect(parseAnswerWriteBody("q7")).toBeNull();
    expect(parseAnswerWriteBody([])).toBeNull();
  });

  it("returns null for an unknown question id", () => {
    expect(
      parseAnswerWriteBody({ question_id: "q99", value: { text: "x" } }),
    ).toBeNull();
  });

  it("returns null when the value is missing or wrong-shaped", () => {
    expect(parseAnswerWriteBody({ question_id: "q7" })).toBeNull();
    expect(
      parseAnswerWriteBody({ question_id: "q7", value: { text: 42 } }),
    ).toBeNull();
  });

  it("accepts the absence of confidence as null", () => {
    const parsed = parseAnswerWriteBody({ question_id: "q1", value: { text: "x" } });
    expect(parsed?.confidence).toBeNull();
  });

  it("rejects a confidence that is present but not an integer 1..5", () => {
    for (const bad of [0, 6, 3.5, "high", -1]) {
      expect(
        parseAnswerWriteBody({ question_id: "q3", value: VALID.q3, confidence: bad }),
      ).toBeNull();
    }
  });
});