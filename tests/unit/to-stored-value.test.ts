import { describe, expect, it } from "vitest";
import { storableAnswerValue } from "../../lib/to-stored-value";
import { isValidAnswerShape } from "../../lib/answer-shape";
import type { Q10Draft } from "../../lib/q10";
import type { Q14Draft } from "../../lib/q14";
import {
  QUESTION_IDS,
  type QuestionAnswerValues,
  type QuestionId,
} from "../../lib/questions";

// Draft → stored-value mapping for autosave (F04-T02). The working drafts of
// most questions are already the §3.1 stored shape and must pass through
// unchanged; Q10 and Q14 hold drafts with different field names and nullable
// placeholders and must be transformed. A draft that cannot yet form a valid
// stored shape must yield null so autosave stands aside (and never persists a
// partial or invented answer).

/** A structurally valid stored value per question (shared with answer-shape). */
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

describe("storableAnswerValue", () => {
  it("passes every draft through unchanged when it is already the §3.1 shape", () => {
    // All questions except Q10 and Q14 have drafts identical to the stored
    // shape, so they must come through as the very same object and still be a
    // valid shape (Q10 and Q14 draft→stored conversion is covered separately).
    for (const id of QUESTION_IDS.filter((x) => x !== "q10" && x !== "q14")) {
      const result = storableAnswerValue(id, VALID[id]);
      expect(result).toBe(VALID[id]);
      expect(isValidAnswerShape(id, result)).toBe(true);
    }
  });

  it("leaves incomplete draft shapes alone rather than inventing a value", () => {
    // A ranking draft with no delete choice is not a storable answer; the raw
    // draft passes through as-is, and the hook's shape guard refuses it.
    const partialRank = {
      rank: ["pedconnect"],
      delete: null,
      why: "",
      predicted: [],
    };
    expect(storableAnswerValue("q8", partialRank)).toBe(partialRank);
    expect(isValidAnswerShape("q8", partialRank)).toBe(false);

    // A metric triple with an empty number is likewise not yet an answer.
    const partialQ3 = { metric: "centers", value: null, unit: "centers", why: "x" };
    expect(storableAnswerValue("q3", partialQ3)).toBe(partialQ3);
    expect(isValidAnswerShape("q3", partialQ3)).toBe(false);
  });

  describe("Q14", () => {
    const draft = (hours: number | null): Q14Draft => ({
      wants: ["product"],
      others: { "t-1": "backend" },
      hours,
      privateNote: "I may need to step back.",
    });

    it("maps a committed draft onto the §3.1 Q14 value, carrying the private note", () => {
      const result = storableAnswerValue("q14", draft(20)) as QuestionAnswerValues["q14"];
      expect(result).toEqual({
        wants: ["product"],
        others: { "t-1": "backend" },
        hours: 20,
        private_note: "I may need to step back.",
      });
      expect(isValidAnswerShape("q14", result)).toBe(true);
    });

    it("returns null until the hours value is committed", () => {
      expect(storableAnswerValue("q14", draft(null))).toBeNull();
    });

    it("returns null for no draft at all", () => {
      expect(storableAnswerValue("q14", undefined)).toBeNull();
    });
  });

  describe("Q10", () => {
    const draft = (over: Partial<Q10Draft> = {}): Q10Draft => ({
      payer: "center",
      model: "monthly subscription per center",
      amount: "2,500",
      firstPeso: "2026-11",
      ...over,
    });

    it("maps a committed draft onto the §3.1 Q10 value: normalised amount, derived unit", () => {
      const result = storableAnswerValue("q10", draft()) as QuestionAnswerValues["q10"];
      expect(result).toEqual({
        payer: "center",
        model: "monthly subscription per center",
        amount: 2500,
        unit: "per center per month",
        first_peso: "2026-11",
      });
      expect(isValidAnswerShape("q10", result)).toBe(true);
    });

    it("returns null until payer, model and a parseable amount all exist", () => {
      expect(storableAnswerValue("q10", draft({ payer: null }))).toBeNull();
      expect(storableAnswerValue("q10", draft({ model: null }))).toBeNull();
      expect(storableAnswerValue("q10", draft({ amount: "" }))).toBeNull();
      expect(storableAnswerValue("q10", undefined)).toBeNull();
    });
  });
});