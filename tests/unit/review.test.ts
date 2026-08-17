import { describe, expect, it } from "vitest";
import { QUESTIONS, type QuestionId } from "../../lib/questions";
import {
  allRequiredQuestionsAnswered,
  buildReviewModel,
  formatAnswerSummary,
  skippedOptionalQuestions,
  type ReviewAnswerRow,
} from "../../lib/review";

// F06-T01 review screen logic, verified without a database. The review model
// is assembled from the respondent's own answer rows, whose private q14d row
// (F01-T03) is re-attached to q14 only here; `allRequiredQuestionsAnswered`
// drives the submit button's secondary styling; `skippedOptionalQuestions`
// feeds the verbatim "You skipped these — that's allowed." list; and the
// summary formatter turns each §3.1 stored shape into a collapsed answer
// summary. All pure, all deterministic, so the review cannot drift from what
// the respondent actually submitted.

const ALL_IDS: QuestionId[] = QUESTIONS.map((q) => q.id);

function row(questionId: string, value: unknown): ReviewAnswerRow {
  return { question_id: questionId, value, confidence: null, is_private: false };
}

function answeredSet(ids: readonly QuestionId[]): Set<QuestionId> {
  return new Set(ids);
}

describe("buildReviewModel", () => {
  it("marks a question answered when an answer row exists and unanswered otherwise", () => {
    const model = buildReviewModel([row("q1", { text: "noise" })]);
    const q1 = model.find((m) => m.id === "q1")!;
    expect(q1.answered).toBe(true);
    expect(model.find((m) => m.id === "q2")!.answered).toBe(false);
  });

  it("returns all fifteen questions in registry order", () => {
    const model = buildReviewModel([]);
    expect(model.map((m) => m.id)).toEqual(ALL_IDS);
  });

  it("reads confidence from the answer row", () => {
    const model = buildReviewModel([
      { question_id: "q8", value: {}, confidence: 4, is_private: false },
    ]);
    expect(model.find((m) => m.id === "q8")!.confidence).toBe(4);
    expect(model.find((m) => m.id === "q8")!.answered).toBe(true);
  });

  it("attaches the q14d private note to q14 and drops blank notes", () => {
    const withNote = buildReviewModel([
      row("q14", { wants: [], others: {}, hours: 5 }),
      { question_id: "q14d", value: { private_note: "worried about runway" }, confidence: null, is_private: true },
    ]);
    expect(withNote.find((m) => m.id === "q14")!.privateNote).toBe("worried about runway");

    const blank = buildReviewModel([
      row("q14", { wants: [], others: {}, hours: 5 }),
      { question_id: "q14d", value: { private_note: "" }, confidence: null, is_private: true },
    ]);
    expect(blank.find((m) => m.id === "q14")!.privateNote).toBeNull();

    // No other question is given a private note even if a q14d row exists.
    for (const m of withNote) {
      if (m.id !== "q14") expect(m.privateNote).toBeNull();
    }
  });
});

describe("allRequiredQuestionsAnswered", () => {
  it("is false while any required question is unanswered, even when optional ones are answered", () => {
    const without = ALL_IDS.filter((id) => id !== "q3");
    expect(allRequiredQuestionsAnswered(answeredSet(without))).toBe(false);
  });

  it("is true when every required question is answered, regardless of optional q15", () => {
    const requiredAnswered = ALL_IDS.filter((id) => {
      const q = QUESTIONS.find((x) => x.id === id)!;
      return q.required;
    });
    expect(allRequiredQuestionsAnswered(answeredSet(requiredAnswered))).toBe(true);
  });

  it("requires specifically the required set — answering only q15 does not complete it", () => {
    expect(allRequiredQuestionsAnswered(answeredSet(["q15"]))).toBe(false);
  });
});

describe("skippedOptionalQuestions", () => {
  it("lists q15 as skipped when it has no answer", () => {
    expect(skippedOptionalQuestions(answeredSet(ALL_IDS.filter((id) => id !== "q15")))).toEqual([
      "q15",
    ]);
  });

  it("is empty once the optional q15 is answered", () => {
    expect(skippedOptionalQuestions(answeredSet(ALL_IDS))).toEqual([]);
  });

  it("never lists a required question as skipped", () => {
    const skipped = skippedOptionalQuestions(answeredSet([]));
    for (const id of skipped) {
      expect(QUESTIONS.find((q) => q.id === id)!.required).toBe(false);
    }
  });
});

describe("formatAnswerSummary", () => {
  it("formats the long-text answers as their text", () => {
    for (const id of ["q1", "q4", "q7", "q12", "q15"] as QuestionId[]) {
      expect(formatAnswerSummary(id, { text: "hello" })).toBe("hello");
    }
  });

  it("formats the sentence completion (q2) as a finished sentence", () => {
    expect(
      formatAnswerSummary("q2", { who: "the therapists", because: "they need the notes" }),
    ).toBe("The people who would miss it most are the therapists, because they need the notes.");
  });

  it("formats the metric triple (q3) with the why line", () => {
    expect(
      formatAnswerSummary("q3", { metric: "centers onboarded", value: 40, unit: "per year", why: "scale" }),
    ).toBe("centers onboarded: 40 per year — scale");
  });

  it("formats the matrix grid (q5) one column per line, 'None' for empty columns", () => {
    const summary = formatAnswerSummary("q5", {
      pays: ["parent"],
      decides: ["center_owner", "parent"],
      uses: [],
      benefits: ["child"],
    });
    expect(summary).toContain("Pays us: Parent or guardian");
    expect(summary).toContain("Decides to adopt: Therapy center owner or director, Parent or guardian");
    expect(summary).toContain("Uses it most days: None");
    expect(summary).toContain("Benefits most: The child");
  });

  it("formats the single choice + reason (q6)", () => {
    expect(formatAnswerSummary("q6", { choice: "center", why: "we sell to centers" })).toBe(
      "Center — we sell to centers",
    );
  });

  it("formats the ranking (q8) with order, delete and prediction", () => {
    const summary = formatAnswerSummary("q8", {
      rank: ["pedconnect", "teachday", "parentup", "pedmd"],
      delete: "pedmd",
      why: "lowest pull",
      predicted: ["teachday", "pedconnect", "parentup", "pedmd"],
    });
    expect(summary).toContain("1. PedConnect");
    expect(summary).toContain("2. TeachDay");
    expect(summary).toContain("Would delete: PedMD");
    expect(summary).toContain("Why: lowest pull");
    expect(summary).toContain("Predicted group #1: TeachDay");
  });

  it("formats the three refusals (q9) as numbered lines", () => {
    const summary = formatAnswerSummary("q9", {
      items: ["no HR tools", "no billing", "no app store"],
    });
    expect(summary).toBe("1. no HR tools\n2. no billing\n3. no app store");
  });

  it("formats the money answer (q10) with the four parts", () => {
    const summary = formatAnswerSummary("q10", {
      payer: "parent",
      model: "per active child per month",
      amount: 500,
      unit: "pesos",
      first_peso: "2026-11",
    });
    expect(summary).toContain("Payer: parent");
    expect(summary).toContain("Model: per active child per month");
    expect(summary).toContain("Pays: 500 pesos");
    expect(summary).toContain("First real peso: 2026-11");
  });

  it("formats the paired rows (q11) with done-conditions and the starred mark", () => {
    const summary = formatAnswerSummary("q11", {
      rocks: [
        { what: "ship beta", done_when: "30 Sept" },
        { what: "get 10 centers", done_when: "31 Dec" },
        { what: "huddle every week", done_when: "ongoing" },
      ],
      starred: 1,
    });
    expect(summary).toContain("1. ship beta — done when: 30 Sept");
    expect(summary).toContain("★ 2. get 10 centers — done when: 31 Dec");
    expect(summary).toContain("3. huddle every week — done when: ongoing");
  });

  it("formats the pre-mortem (q13) with the most likely cause", () => {
    const summary = formatAnswerSummary("q13", {
      text: "we ran out of money",
      cause: "ran out of money",
    });
    expect(summary).toBe("we ran out of money\nMost likely cause: ran out of money");
  });

  it("formats q14 public fields, resolving teammate ids through the name resolver", () => {
    const summary = formatAnswerSummary(
      "q14",
      { wants: ["product", "fundraising"], others: { "teammate-1": "backend" }, hours: 12 },
      (rid) => (rid === "teammate-1" ? "Maya" : undefined),
    );
    expect(summary).toContain("Wants to own: product, fundraising");
    expect(summary).toContain("Thinks others own:");
    expect(summary).toContain("Maya: backend");
    expect(summary).toContain("Hours a week: 12");
  });
});