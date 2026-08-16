import { describe, expect, it } from "vitest";
import {
  APP_IDS,
  checkDivergenceFixture,
  questionIds,
  Q10Value,
  Q3Value,
  SEED_RESPONDENTS,
  type SeedAnswer,
} from "../../lib/seed";

// F01-T05 seed fixture, verified without a database: the data itself must
// guarantee the behaviours the ticket demands, so F10's scorer can later rely
// on it. The write path (RLS, q14d split, idempotency) is covered separately
// by seed.integration.test.ts.

const CONFIDENCE_QUESTIONS = new Set(["q3", "q4", "q7", "q8", "q10", "q11"]);

function answersFor(
  respondentId: string,
): Map<string, SeedAnswer> {
  const respondent = SEED_RESPONDENTS.find((r) => r.id === respondentId);
  if (!respondent) throw new Error(`unknown seed respondent ${respondentId}`);
  return new Map(respondent.answers.map((a) => [a.question_id, a]));
}

describe("seed cohort (F01-T05)", () => {
  it("creates six respondents, exactly one of whom is the facilitator", () => {
    expect(SEED_RESPONDENTS).toHaveLength(6);
    expect(SEED_RESPONDENTS.filter((r) => r.is_facilitator)).toHaveLength(1);
  });

  it("every respondent answers all fifteen questions, exactly once", () => {
    for (const respondent of SEED_RESPONDENTS) {
      const ids = respondent.answers.map((a) => a.question_id);
      expect(ids).toHaveLength(questionIds.length);
      expect([...ids].sort()).toEqual([...questionIds].sort());
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
    }
  });

  it("populates confidence only on Q3, Q4, Q7, Q8, Q10 and Q11", () => {
    for (const respondent of SEED_RESPONDENTS) {
      for (const answer of respondent.answers) {
        if (CONFIDENCE_QUESTIONS.has(answer.question_id)) {
          expect(
            answer.confidence,
            `${respondent.display_name} Q${answer.question_id} confidence missing`,
          ).toBeDefined();
          expect(answer.confidence).toBeGreaterThanOrEqual(1);
          expect(answer.confidence).toBeLessThanOrEqual(5);
        } else {
          expect(
            answer.confidence,
            `${respondent.display_name} Q${answer.question_id} should carry no confidence`,
          ).toBeUndefined();
        }
      }
    }
  });

  it("yields one aligned, one soft split and one hard split", () => {
    expect(() => checkDivergenceFixture()).not.toThrow();
  });

  it("deliberately conflicts: the sharp questions are not unanimous", () => {
    const distinctOf = (questionId: string, pick: (a: SeedAnswer) => unknown) =>
      new Set(
        SEED_RESPONDENTS.map((r) => pick(answersFor(r.id).get(questionId)!)),
      );

    const q6Choices = distinctOf("q6", (a) => (a.value as { choice: string }).choice);
    const q8Leads = distinctOf("q8", (a) => (a.value as { rank: string[] }).rank[0]);
    const q10Models = distinctOf("q10", (a) => (a.value as Q10Value).model);

    expect(q6Choices.size).toBeGreaterThan(1);
    expect(q8Leads.size).toBe(2);
    expect(q10Models.size).toBe(2);
  });

  it("populates at least two q14d private rows (non-empty private notes)", () => {
    const withNote = SEED_RESPONDENTS.filter((r) => {
      const q14 = answersFor(r.id).get("q14")!;
      return (q14.value as { private_note?: string }).private_note;
    });
    expect(withNote.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps q8 ranks a full ranking of the four apps", () => {
    for (const id of SEED_RESPONDENTS.map((r) => r.id)) {
      const q8 = answersFor(id).get("q8")!;
      const rank = (q8.value as { rank: string[] }).rank;
      expect(new Set(rank)).toEqual(new Set(APP_IDS));
      expect(rank).toHaveLength(APP_IDS.length);
    }
  });

  it("keeps q14 wants capped at three and hours within range", () => {
    for (const id of SEED_RESPONDENTS.map((r) => r.id)) {
      const q14 = answersFor(id).get("q14")!;
      const value = q14.value as { wants: string[]; hours: number };
      expect(value.wants.length).toBeLessThanOrEqual(3);
      expect(value.hours).toBeGreaterThanOrEqual(0);
      expect(value.hours).toBeLessThanOrEqual(60);
    }
  });

  it("places the aligned/soft/hard splits on confidence-bearing questions", () => {
    // The ticket needs the three Part C categories scorable now and against
    // real stored confidence, so the aligned (Q3), soft split (Q10) and hard
    // split (Q8) all live on questions that carry a confidence value.
    for (const q of ["q3", "q10", "q8"]) {
      expect(CONFIDENCE_QUESTIONS.has(q), `${q} must be confidence-bearing`).toBe(true);
    }
  });

  it("mixes answers across respondents (no two rows are identical)", () => {
    const signatures = SEED_RESPONDENTS.map((r) =>
      JSON.stringify(r.answers.map((a) => a.value)),
    );
    expect(new Set(signatures).size).toBe(SEED_RESPONDENTS.length);
  });

  it("records a positive, sensible Q3 value", () => {
    for (const id of SEED_RESPONDENTS.map((r) => r.id)) {
      const q3 = answersFor(id).get("q3")!;
      const value = q3.value as Q3Value;
      expect(value.unit).toBe("paying_centers");
      expect(value.value).toBeGreaterThan(0);
    }
  });
});