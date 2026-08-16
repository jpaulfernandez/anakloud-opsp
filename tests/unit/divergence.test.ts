import { describe, expect, it } from "vitest";
import { isConfidenceQuestion } from "../../lib/confidence";
import {
  DIVERGENCE_CONFIG_DEFAULTS,
  DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN_ENV,
  loadDivergenceConfig,
} from "../../lib/divergence-config";
import {
  CLOSED_QUESTION_IDS,
  classifyDivergence,
  computeAgreement,
  OPEN_TEXT_QUESTION_IDS,
  type DivergenceAnswerInput,
} from "../../lib/divergence";
import { QUESTION_IDS } from "../../lib/questions";
import { SEED_RESPONDENTS, type SeedAnswer } from "../../lib/seed";

// F10-T01 divergence scoring library, verified without a database or any AI
// provider. Everything here is deterministic pure scoring — the L2/L3
// fallback that makes acceptance criterion 11 and the key-removal gate true.
// The fixture is the seed respondents' deliberately conflicting answers
// (F01-T05), so the aligned / soft split / hard split categories fall out of
// real stored data, not hand-built happy cases.

const q3 = { metric: "m", value: 1, unit: "centers", why: "x" };
const q3b = { metric: "m", value: 2, unit: "visits", why: "x" };

function answer(
  value: unknown,
  confidence: number | null = null,
  is_private = false,
): DivergenceAnswerInput {
  return { value, confidence, is_private };
}

/** Collect every respondent's seed answer to one question as scoring input. */
function seedAnswersFor(questionId: string): DivergenceAnswerInput[] {
  return SEED_RESPONDENTS.map((r) => {
    const a = r.answers.find(
      (x) => x.question_id === questionId,
    ) as SeedAnswer;
    return answer(a.value, a.confidence ?? null);
  });
}

describe("mode partition (F10-T01)", () => {
  it("open and closed partition every question exactly once", () => {
    const open = new Set<string>(OPEN_TEXT_QUESTION_IDS);
    const closed = new Set<string>(CLOSED_QUESTION_IDS);
    expect([...open, ...closed].length).toBe(QUESTION_IDS.length);
    for (const id of QUESTION_IDS) {
      // XOR: each question is either open text or closed form, never both.
      expect(open.has(id)).not.toBe(closed.has(id));
    }
  });

  it("the seed's three sharp questions are closed and confidence-bearing", () => {
    // The aligned (q3), soft split (q10) and hard split (q8) expectations only
    // make sense if those questions are closed (exactly comparable) and carry
    // a confidence value, per the fixture.
    for (const id of ["q3", "q8", "q10"] as const) {
      expect(CLOSED_QUESTION_IDS).toContain(id);
      expect(isConfidenceQuestion(id)).toBe(true);
    }
  });

  it("open text includes every prose question, and it never carries a comparison", () => {
    for (const id of OPEN_TEXT_QUESTION_IDS) {
      const res = classifyDivergence(id, seedAnswersFor(id));
      expect(res.mode).toBe("open");
      expect(res.agreementRate).toBeNull();
      expect(res.spread).toBeNull();
      expect(res.modalAnswer).toBeNull();
    }
  });
});

describe("closed questions compute agreement, modal and spread", () => {
  it("every closed question reports a non-null agreement rate on seeded data", () => {
    // Acceptance: all closed questions classify with the provider removed.
    for (const id of CLOSED_QUESTION_IDS) {
      const res = classifyDivergence(id, seedAnswersFor(id));
      expect(res.mode, id).toBe("closed");
      expect(res.agreementRate, id).not.toBeNull();
      expect(res.spread, id).not.toBeNull();
      expect(res.modalAnswer, id).not.toBeNull();
    }
  });

  it("non-confidence closed questions report agreement but never a category", () => {
    for (const id of ["q5", "q6", "q14"] as const) {
      expect(isConfidenceQuestion(id)).toBe(false);
      const res = classifyDivergence(id, seedAnswersFor(id));
      expect(res.category).toBeNull();
      expect(res.agreementRate).not.toBeNull();
      expect(res.spread).not.toBeNull();
    }
  });

  it("computeAgreement returns the modal's exact share", () => {
    expect(computeAgreement(["a", "b", "a"])).toEqual({
      agreementRate: 2 / 3,
      modalAnswer: "a",
    });
    expect(computeAgreement([])).toEqual({
      agreementRate: null,
      modalAnswer: null,
    });
  });
});

describe("classification on seeded conflicting data", () => {
  it("yields at least one aligned, one soft split and one hard split", () => {
    const categories = CLOSED_QUESTION_IDS.filter((id) =>
      isConfidenceQuestion(id),
    ).map((id) => classifyDivergence(id, seedAnswersFor(id)).category);
    expect(categories).toContain("aligned");
    expect(categories).toContain("soft split");
    expect(categories).toContain("hard split");
  });

  it("labels the seeded sharp questions as intended", () => {
    expect(classifyDivergence("q3", seedAnswersFor("q3")).category).toBe(
      "aligned",
    );
    expect(classifyDivergence("q10", seedAnswersFor("q10")).category).toBe(
      "soft split",
    );
    expect(classifyDivergence("q8", seedAnswersFor("q8")).category).toBe(
      "hard split",
    );
  });
});

describe("boundary between soft and hard split", () => {
  const twoCamps = (confidence: number): DivergenceAnswerInput[] => [
    answer(q3, confidence), // unit "centers"
    answer(q3b, confidence), // unit "visits" — a real split
  ];

  it("mean confidence at the threshold is a hard split, just below is soft", () => {
    // default hardSplitConfidenceMin = 4
    expect(classifyDivergence("q3", twoCamps(4)).category).toBe("hard split");
    expect(classifyDivergence("q3", twoCamps(3)).category).toBe("soft split");
  });

  it("a split with no confidence is a split, not aligned", () => {
    // Both camps carry null confidence: spread is real, so it must not read as
    // consensus even though we cannot grade its confidence.
    expect(classifyDivergence("q3", [answer(q3), answer(q3b)]).category).toBe(
      "soft split",
    );
  });
});

describe("thresholds come from config, never from call sites", () => {
  it("changes to the config change the classification without changing code", () => {
    const q8 = seedAnswersFor("q8");
    const defaults = DIVERGENCE_CONFIG_DEFAULTS;

    expect(classifyDivergence("q8", q8).category).toBe("hard split");

    // Raise the confidence bar above the seed mean (~4.7): the same answers
    // now grade as a soft split.
    expect(
      classifyDivergence("q8", q8, {
        ...defaults,
        hardSplitConfidenceMin: 5,
      }).category,
    ).toBe("soft split");

    // Widen the aligned spread ceiling so even the 3-3 split counts as
    // consensus — an operationally meaningless but demonstrably configurable
    // shift that proves the knob lives in config.
    expect(
      classifyDivergence("q8", q8, {
        ...defaults,
        alignedSpreadMax: 1,
      }).category,
    ).toBe("aligned");
  });
});

describe("private-row exclusion", () => {
  it("drops private rows from the scoring input and counts them as excluded", () => {
    const res = classifyDivergence("q14", [
      answer({ wants: ["a"], hours: 10 }),
      answer({ wants: ["b"], hours: 20 }),
      answer({ private_note: "I may need to leave." }, null, true),
    ]);
    expect(res.included).toBe(2);
    expect(res.privateExcluded).toBe(1);
  });

  it("a private-only input scores nothing", () => {
    const res = classifyDivergence("q14", [
      answer({ private_note: "only private" }, null, true),
    ]);
    expect(res.included).toBe(0);
    expect(res.privateExcluded).toBe(1);
    expect(res.agreementRate).toBeNull();
    expect(res.category).toBeNull();
  });
});

describe("open text flagged for manual review", () => {
  it("reports word counts and length spread for seeded prose", () => {
    const res = classifyDivergence("q1", seedAnswersFor("q1"));
    expect(res.category).toBe("manual review");
    expect(res.wordCounts).toHaveLength(SEED_RESPONDENTS.length);
    for (const n of res.wordCounts!) {
      expect(n).toBeGreaterThan(0);
    }
    expect(res.lengthSpread).toBe(
      Math.max(...res.wordCounts!) - Math.min(...res.wordCounts!),
    );
  });

  it("sentence completion and paired rows concatenate their fields for counting", () => {
    const q2 = classifyDivergence("q2", [
      answer({ who: "admins", because: "they lose the roster" }),
      answer({ who: "therapists", because: "they can't track progress" }),
    ]);
    expect(q2.wordCounts).toEqual([5, 5]);
    expect(q2.lengthSpread).toBe(0);
  });

  it("open questions still surface their mean confidence where present", () => {
    expect(classifyDivergence("q4", seedAnswersFor("q4")).meanConfidence).not.toBeNull();
    expect(classifyDivergence("q12", seedAnswersFor("q12")).meanConfidence).toBeNull();
  });
});

describe("empty inputs", () => {
  it("no answers scores nulls and no category", () => {
    const closed = classifyDivergence("q8", []);
    expect(closed.agreementRate).toBeNull();
    expect(closed.spread).toBeNull();
    expect(closed.category).toBeNull();

    const open = classifyDivergence("q1", []);
    expect(open.wordCounts).toEqual([]);
    expect(open.lengthSpread).toBeNull();
    expect(open.category).toBeNull();
  });
});

describe("divergence config loader", () => {
  it("defaults when nothing is set, overrides when an env is present", () => {
    expect(loadDivergenceConfig({})).toEqual(DIVERGENCE_CONFIG_DEFAULTS);
    expect(
      loadDivergenceConfig({ [DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN_ENV]: "5" }),
    ).toEqual({ alignedSpreadMax: 0, hardSplitConfidenceMin: 5 });
  });

  it("ignores malformed overrides and keeps the documented default", () => {
    expect(
      loadDivergenceConfig({
        [DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN_ENV]: "not-a-number",
      }),
    ).toEqual(DIVERGENCE_CONFIG_DEFAULTS);
  });
});