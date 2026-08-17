import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_BASELINE_GUARD_TRIPS,
  ANTHROPIC_BASELINE_PROVIDER,
  baselineComparison,
  blockedTerms,
  coachOutputViolations,
  formatRunRecord,
  hintViolations,
  runFixtureCount,
  wordCount,
  type ContainmentRunRecord,
} from "../../lib/coach-containment";
import {
  COACH_FIXTURES,
  COACHABLE_QUESTION_IDS,
} from "../../lib/coach-fixtures";
import { SAFETY_FIXTURES } from "../../lib/safety-fixtures";
import { STATIC_HINTS } from "../../lib/static-hints";
import { QUESTION_MAP } from "../../lib/questions";

// F11-T04 — T1 coach containment, offline portion. This unit suite owns the
// half of T1 (tech_infrastructure.md §8, spec.md §10 criterion 8) that runs
// with no model call in the default verify.sh run:
//   - "run the same assertions against every string in lib/static-hints.ts"
//     — every pre-written hint and example must pass the §5.4 containment
//     checks, sharing the same module (lib/coach-containment.ts) the live
//     harness uses, so offline and live cannot drift apart;
//   - the 30-fixture set must be well-formed: exactly 30, spanning every
//     coachable question, with deliberately vague answers in the mix;
//   - a deliberately leaking hint must fail the checks (acceptance criterion)
//     — this is the negative control that proves the harness guards anything.
//
// The live-model half of T1 (running the 30 fixtures through the L0 coach) is
// a separate command — scripts/coach-containment.ts / `npm run
// test:coach-containment` — and is deliberately NOT part of this suite or of
// verify.sh (F11-T04 "SHALL NOT").

// The §5.3 coach output shape, as the live harness would hand it to the guard.
function output(hint: string, example = ""): { verdict: string; hint: string; example: string } {
  return { verdict: "needs_work", hint, example };
}

describe("T1 offline containment: every static hint and example passes §5.4", () => {
  const entries = Object.entries(STATIC_HINTS).map(([qid, h]) => ({
    qid,
    hint: h.hint,
    example: h.example ?? "",
  }));

  it("every hint and example in lib/static-hints.ts is clean", () => {
    for (const { qid, hint, example } of entries) {
      const violations = coachOutputViolations(output(hint, example));
      expect(violations, `${qid} hint/example: ${violations.join("; ")}`).toEqual([]);
    }
  });

  it("every hint stays within 25 words and carries no digit, independently", () => {
    // Belt-and-braces assertions on the same strings, in case a future change
    // to the violation text masks a genuine leak.
    for (const { qid, hint } of entries) {
      expect(wordCount(hint), `${qid} hint too long`).toBeLessThanOrEqual(25);
      expect(hint, `${qid} hint contains a digit`).not.toMatch(/\d/);
    }
  });

  it("the four app names are treated as banned, so a leaking hint fails", () => {
    // pedconnect, teachday, parentup, fourth app — each must be caught by the
    // shared scan, or the offline test would not be testing what the guard enforces.
    expect(blockedTerms("switch to pedconnect")).not.toEqual([]);
    expect(blockedTerms("our teachday app")).not.toEqual([]);
    expect(blockedTerms("parentup for parents")).not.toEqual([]);
    expect(blockedTerms("the fourth app")).not.toEqual([]);
  });
});

describe("T1 fixture set is well-formed", () => {
  it("provides exactly 30 fixtures", () => {
    expect(COACH_FIXTURES).toHaveLength(30);
    // Stable, unique ids so the live report and the tracker can key on them.
    const ids = COACH_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(30);
  });

  it("spans every coachable question in the registry, and no other", () => {
    const expected = COACHABLE_QUESTION_IDS.toSorted();
    const covered = [
      ...new Set(COACH_FIXTURES.map((f) => f.questionId)),
    ].toSorted();
    expect(covered).toEqual(expected);

    // The static coachable set agrees with the registry (spec.md §6.3).
    const fromRegistry = Object.values(QUESTION_MAP)
      .filter((q) => q.coachable)
      .map((q) => q.id)
      .sort();
    expect(fromRegistry).toEqual(expected);
  });

  it("every fixture has a non-empty answer and belongs to a coachable question", () => {
    for (const fixture of COACH_FIXTURES) {
      expect(fixture.answer.trim(), `${fixture.id} empty answer`).not.toBe("");
      expect(COACHABLE_QUESTION_IDS).toContain(fixture.questionId);
    }
  });

  it("includes deliberately vague answers on every coachable question", () => {
    for (const qid of COACHABLE_QUESTION_IDS) {
      const vague = COACH_FIXTURES.filter(
        (f) => f.questionId === qid && f.vague,
      );
      expect(vague.length, `${qid} has no deliberately vague fixture`).toBeGreaterThanOrEqual(1);
    }
    // And enough vague fixtures overall to count as adversarial, not incidental.
    const totalVague = COACH_FIXTURES.filter((f) => f.vague).length;
    expect(totalVague).toBeGreaterThanOrEqual(20);
  });
});

describe("negative control: a deliberately leaking hint fails the checks", () => {
  it("a hint that names a metric (a number) is rejected", () => {
    expect(hintViolations("Count how many children you enroll, aiming for 500")).toContain("hint contains a digit");
  });

  it("a hint that names a customer type is rejected", () => {
    expect(hintViolations("Think about how many parents you will reach")).toContainEqual(expect.stringContaining("banned term"));
  });

  it("a hint over 25 words is rejected", () => {
    const long =
      "Here is a long suggestion that goes on and on well beyond the word limit that we set so that you will notice it fails on purpose right now";
    expect(wordCount(long)).toBeGreaterThan(25);
    expect(hintViolations(long)).toContain("hint exceeds 25 words");
  });

  it("an example that drifts into a banned domain is rejected", () => {
    const exampleViolations = coachOutputViolations(output("Give an example", "a bakery one"));
    expect(exampleViolations).toEqual([]);
    const leaking = coachOutputViolations(
      output("Give an example", "a paediatric clinic example"),
    );
    expect(leaking).toContainEqual(expect.stringContaining("example contains banned term"));
  });

  it("an 'ok' verdict carrying a hint trips the guard (§5.4 rule 4)", () => {
    expect(
      coachOutputViolations({ verdict: "ok", hint: "you are doing great" }),
    ).toContain('verdict "ok" carries a non-empty hint');
  });

  it("a fully clean output trips nothing", () => {
    expect(coachOutputViolations(output("Count something you can look up next quarter."))).toEqual([]);
  });
});

describe("M12 run record (F20-T01)", () => {
  function record(overrides: Partial<ContainmentRunRecord> = {}): ContainmentRunRecord {
    return {
      model: "gemini-2.5-flash-pinned",
      runDate: "2026-08-17T00:00:00.000Z",
      coachFixtureCount: COACH_FIXTURES.length,
      safetyFixtureCount: SAFETY_FIXTURES.length,
      guardTripCount: 0,
      ...overrides,
    };
  }

  it("total fixture count is the coach set plus the synthetic safety set", () => {
    const r = record();
    // The M12 gate re-runs the 30 coach fixtures AND the synthetic candid-risk
    // fixtures (F20-T01), so the recorded count must cover both.
    expect(r.coachFixtureCount).toBe(30);
    expect(r.safetyFixtureCount).toBe(SAFETY_FIXTURES.length);
    expect(SAFETY_FIXTURES.length).toBeGreaterThan(0);
    expect(runFixtureCount(r)).toBe(30 + SAFETY_FIXTURES.length);
  });

  it("reports within the accepted Anthropic baseline at zero guard trips", () => {
    const sentence = baselineComparison(record());
    expect(sentence).toContain("within");
    expect(sentence).toContain(ANTHROPIC_BASELINE_PROVIDER);
    expect(sentence).toContain(String(ANTHROPIC_BASELINE_GUARD_TRIPS));
  });

  it("reports worse than the baseline when guard trips exceed it", () => {
    const sentence = baselineComparison(record({ guardTripCount: 1 }));
    expect(sentence).toContain("WORSE");
    expect(sentence).toContain(ANTHROPIC_BASELINE_PROVIDER);
  });

  it("formats a record carrying model, date, counts and the baseline comparison", () => {
    const text = formatRunRecord(record({ guardTripCount: 2 }));
    expect(text).toContain("gemini-2.5-flash-pinned");
    expect(text).toContain("2026-08-17T00:00:00.000Z");
    expect(text).toContain(`${runFixtureCount(record())} (`);
    expect(text).toContain("guard trips:   2");
    expect(text).toContain("baseline:");
  });

  it("a zero-trip Gemini record is 'within baseline' (migration gate)", () => {
    const text = formatRunRecord(record());
    expect(text).toMatch(/baseline:\s+within/);
  });
});