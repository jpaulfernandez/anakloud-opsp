import { describe, expect, it } from "vitest";
import { QUESTIONS, type QuestionId } from "../../lib/questions";
import {
  REQUIRED_UNANSWERED_MESSAGE,
  canAdvance,
  firstUnanswered,
  isRegisteredQuestion,
  questionNeighbors,
  questionRouteSegment,
  toQuestionId,
} from "../../lib/navigation";

// F03-T01 question shell navigation, verified without a database. The shell
// renders one question per screen; the rules that live here are the FR-8/FR-9
// branch the shell depends on — which question comes next, and whether forward
// movement is allowed. `canAdvance` is the whole of "forward skipping is
// allowed for optional questions only" (FR-9): required questions block until
// answered, optional questions never do, and a block carries an explanatory
// reason rather than a silent or disabled refusal (F03-T01 acceptance).

const ALL_IDS = QUESTIONS.map((q) => q.id);
const REQUIRED = ALL_IDS.filter((id) => { const q = QUESTIONS.find((x) => x.id === id)!; return q.required; });
const OPTIONAL = ALL_IDS.filter((id) => { const q = QUESTIONS.find((x) => x.id === id)!; return !q.required; });

describe("isRegisteredQuestion", () => {
  it("accepts every id in the registry", () => {
    for (const id of ALL_IDS) expect(isRegisteredQuestion(id)).toBe(true);
  });

  it("rejects anything outside q1..q15", () => {
    for (const id of ["", "q0", "q16", "foo", "qseven", "/q/3", "q 3"]) {
      expect(isRegisteredQuestion(id)).toBe(false);
    }
  });
});

describe("toQuestionId / questionRouteSegment (URL ↔ registry)", () => {
  it("maps a numeric /q/[id] segment to the registry id", () => {
    for (let i = 1; i <= 15; i++) {
      const segment = String(i);
      const qid = `q${i}` as QuestionId;
      expect(toQuestionId(segment)).toBe(qid);
      expect(questionRouteSegment(qid)).toBe(segment);
    }
  });

  it("returns null for a segment that names no question", () => {
    for (const segment of ["0", "16", "4.5", "q3", "", " ", "abc"]) {
      expect(toQuestionId(segment), `"${segment}"`).toBeNull();
    }
  });

  it("round-trips there and back for every registered question", () => {
    for (const id of ALL_IDS) {
      const segment = questionRouteSegment(id);
      expect(toQuestionId(segment)).toBe(id);
    }
  });
});

describe("questionNeighbors", () => {
  it("returns null for an unknown id", () => {
    expect(questionNeighbors("foo")).toBeNull();
  });

  it("walks the registry in order", () => {
    for (let i = 0; i < ALL_IDS.length; i++) {
      const id = ALL_IDS[i];
      const n = questionNeighbors(id)!;
      expect(n.index).toBe(i);
      expect(n.absolute).toBe(i + 1);
      expect(n.prev).toBe(i > 0 ? ALL_IDS[i - 1] : null);
      expect(n.next).toBe(i < ALL_IDS.length - 1 ? ALL_IDS[i + 1] : null);
      expect(n.isFirst).toBe(i === 0);
      expect(n.isLast).toBe(i === ALL_IDS.length - 1);
    }
  });

  it("first question has no Back, last has no Continue", () => {
    const first = questionNeighbors("q1")!;
    expect(first.isFirst).toBe(true);
    expect(first.prev).toBeNull();
    expect(first.next).toBe("q2");

    const last = questionNeighbors("q15")!;
    expect(last.isLast).toBe(true);
    expect(last.next).toBeNull();
    expect(last.prev).toBe("q14");
  });
});

describe("canAdvance (FR-9 forward skipping)", () => {
  it("blocks every required question while unanswered, with the quoted reason", () => {
    for (const id of REQUIRED) {
      const d = canAdvance(id, new Set());
      expect(d.kind).toBe("blocked");
      if (d.kind === "blocked") {
        expect(d.reason).toBe(REQUIRED_UNANSWERED_MESSAGE);
      }
    }
  });

  it("lets a required question advance once answered", () => {
    for (const id of REQUIRED) {
      expect(canAdvance(id, new Set([id])).kind).toBe("advance");
    }
  });

  it("only the question's own answer unblocks it — another answer does not", () => {
    const d = canAdvance("q3", new Set(["q1"]));
    expect(d.kind).toBe("blocked");
    expect(canAdvance("q3", new Set(["q1", "q3"])).kind).toBe("advance");
  });

  it("never blocks an optional question, so it can be skipped unanswered", () => {
    for (const id of OPTIONAL) {
      expect(canAdvance(id, new Set()).kind).toBe("advance");
    }
  });

  it("the optional question is the only non-required one in the registry", () => {
    // The forward-skip rule is content-agnostic, but this pins the expectation
    // that exactly Q15 is the skippable screen. If a second question becomes
    // optional, this test flags it deliberately rather than silently.
    expect(OPTIONAL).toEqual(["q15"]);
  });
});

describe("firstUnanswered (F04-T05 resume landing)", () => {
  it("returns q1 when nothing is answered", () => {
    expect(firstUnanswered(new Set())).toBe("q1");
  });

  it("returns null when every question is answered", () => {
    expect(firstUnanswered(new Set(ALL_IDS))).toBeNull();
  });

  it("resuming with Q1-Q6 answered lands on Q7", () => {
    const answered = new Set(ALL_IDS.slice(0, 6));
    expect(firstUnanswered(answered)).toBe("q7");
  });

  it("resuming with Q1-Q6 and Q9 answered lands on Q7, not Q10", () => {
    // A gap before an answered question: Q7 and Q8 are unanswered while Q9 is
    // answered, so the first unanswered is still Q7 — never dumped at Q10.
    const answered = new Set([...ALL_IDS.slice(0, 6), "q9" as QuestionId]);
    expect(firstUnanswered(answered)).toBe("q7");
  });

  it("walks the registry in order regardless of which later questions are answered", () => {
    const sparse = new Set<QuestionId>([
      "q1", "q2", "q3", "q10", "q12", "q15",
    ]);
    expect(firstUnanswered(sparse)).toBe("q4");

    expect(firstUnanswered(new Set(ALL_IDS.filter((id) => id !== "q15")))).toBe("q15");
  });

  it("a late optional question is still the first unanswered when the rest are done", () => {
    const allButQ15 = new Set(ALL_IDS.filter((id) => id !== "q15"));
    expect(firstUnanswered(allButQ15)).toBe("q15");
  });
});