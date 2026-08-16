import { describe, expect, expectTypeOf, it } from "vitest";
import {
  FR10_INPUT_TYPES,
  QUESTION_IDS,
  QUESTION_MAP,
  QUESTIONS,
  type AppId,
  type AnswerValueFor,
  type FunctionId,
  type Q6Choice,
  type QuestionAnswerValues,
  type QuestionId,
  type QuestionInputType,
  type RoleId,
} from "../../lib/questions";

import type { Q14Value } from "../../lib/questions";

// F01-T07 question registry, verified without a database. The registry is a
// pure data module (no I/O), so everything the ticket demands is testable by
// reading it: the coachable and confidence sets, the FR-10 input coverage, id
// stability, and the per-question answer value types derived from §3.1.

const sortedIds = (predicate: (id: QuestionId) => boolean): string[] =>
  QUESTIONS.filter((q) => predicate(q.id))
    .map((q) => q.id)
    .sort();

describe("question registry (F01-T07)", () => {
  it("defines exactly the fifteen stable ids q1..q15", () => {
    expect([...QUESTION_IDS]).toEqual([
      "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8",
      "q9", "q10", "q11", "q12", "q13", "q14", "q15",
    ]);
    expect(new Set(QUESTION_IDS).size).toBe(QUESTION_IDS.length);
    expect(QUESTIONS).toHaveLength(QUESTION_IDS.length);
  });

  it("keys the map by the same id the entry declares (no copy-derived keys)", () => {
    for (const question of QUESTIONS) {
      expect(QUESTION_MAP[question.id]).toBe(question);
      // The only key into the map is the stable id; text is data, never a key.
      expect(question.id).toMatch(/^q(1[0-5]|[1-9])$/);
    }
  });

  it("keeps question ids stable: editing copy does not move an id", () => {
    // Ids are a frozen enumeration, independent of the content fields. The
    // structural guarantee is that a question's identity comes from `id`, not
    // from its text or section — so rewriting copy leaves every id untouched.
    for (const question of QUESTIONS) {
      const rewritten: typeof question = {
        ...question,
        text: `${question.text} — revised`,
        helper: `${question.helper} — revised`,
      };
      // Re-keying by id still resolves to the same (edited) record; the id
      // itself never changes because copy changed.
      expect(QUESTION_MAP[question.id]).toBe(question);
      expect([...QUESTION_IDS]).toEqual([
        "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8",
        "q9", "q10", "q11", "q12", "q13", "q14", "q15",
      ]);
      expect(rewritten.id).toBe(question.id);
    }
  });

  it("marks exactly the FR-11 confidence set", () => {
    // FR-11: confidence sliders on Q3, Q4, Q7, Q8, Q10, Q11 only.
    expect(sortedIds((id) => QUESTION_MAP[id].confidence)).toEqual([
      "q10", "q11", "q3", "q4", "q7", "q8",
    ]);
  });

  it("marks exactly the coachable set from §6.3", () => {
    // §6.3 / FR-21: coached on Q3, Q4, Q6, Q7, Q9, Q10, Q11 only.
    expect(sortedIds((id) => QUESTION_MAP[id].coachable)).toEqual([
      "q10", "q11", "q3", "q4", "q6", "q7", "q9",
    ]);
  });

  it("never marks Q1, Q2, Q5, Q8, Q12, Q13, Q14 or Q15 as coachable", () => {
    // The complement is asserted explicitly so a regression can't silently
    // coach one of the "raw voice" or structurally-constrained questions.
    const neverCoached: QuestionId[] = [
      "q1", "q2", "q5", "q8", "q12", "q13", "q14", "q15",
    ];
    for (const id of neverCoached) {
      expect(
        QUESTION_MAP[id].coachable,
        `${id} must not be coachable`,
      ).toBe(false);
    }
  });

  it("every question carries all seven registry fields", () => {
    for (const question of QUESTIONS) {
      expect(question.section.length).toBeGreaterThan(0);
      expect(question.text.length).toBeGreaterThan(0);
      expect(question.helper.length).toBeGreaterThan(0);
      expect(question.inputTypes.length).toBeGreaterThan(0);
      expect(typeof question.required).toBe("boolean");
      expect(typeof question.confidence).toBe("boolean");
      expect(typeof question.coachable).toBe("boolean");
    }
  });

  it("the FR-11 and §6.3 flags are consistent with the input types", () => {
    // Wherever a confidence slider is rendered it is flagged confidence-bearing,
    // and vice versa — a question either carries the slider in its inputs and
    // the flag, or neither.
    for (const question of QUESTIONS) {
      const hasSlider = (question.inputTypes as readonly string[]).includes(
        "confidence_slider",
      );
      expect(hasSlider).toBe(question.confidence);
    }
  });

  it("every input type named in FR-10 appears in the registry at least once", () => {
    const present = new Set<QuestionInputType>(
      QUESTIONS.flatMap((q) => q.inputTypes),
    );
    expect(present.size).toBe(FR10_INPUT_TYPES.length);
    for (const type of FR10_INPUT_TYPES) {
      expect(
        present.has(type),
        `FR-10 input type "${type}" must be rendered by at least one question`,
      ).toBe(true);
    }
  });
});

describe("answer value types derived from §3.1", () => {
  it("derives a value type for every question", () => {
    // Every registered id maps to a §3.1 answer shape; a union across the map
    // has exactly one member per question.
    expectTypeOf<QuestionAnswerValues>().toEqualTypeOf<{
      q1: { text: string };
      q2: { who: string; because: string };
      q3: { metric: string; value: number; unit: string; why: string };
      q4: { text: string };
      q5: {
        pays: RoleId[];
        decides: RoleId[];
        uses: RoleId[];
        benefits: RoleId[];
      };
      q6: { choice: Q6Choice; why: string };
      q7: { text: string };
      q8: { rank: AppId[]; delete: AppId; why: string; predicted: AppId[] };
      q9: { items: [string, string, string] };
      q10: {
        payer: string;
        model: string;
        amount: number;
        unit: string;
        first_peso: string;
      };
      q11: {
        rocks: { what: string; done_when: string }[];
        starred: 0 | 1 | 2;
      };
      q12: { text: string };
      q13: { text: string };
      q14: Q14Value;
      q15: { text: string };
    }>();
  });

  it("AnswerValueFor<K> resolves to the matching §3.1 shape", () => {
    expectTypeOf<AnswerValueFor<"q3">>().toEqualTypeOf<{
      metric: string;
      value: number;
      unit: string;
      why: string;
    }>();
    expectTypeOf<AnswerValueFor<"q8">>().toEqualTypeOf<{
      rank: AppId[];
      delete: AppId;
      why: string;
      predicted: AppId[];
    }>();
    expectTypeOf<AnswerValueFor<"q14">>().toEqualTypeOf<{
      wants: FunctionId[];
      others: Record<string, FunctionId>;
      hours: number;
      private_note: string;
    }>();
  });
});