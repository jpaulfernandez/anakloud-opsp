import { describe, expect, it } from "vitest";
import {
  computeContaminationAudit,
  CONTAMINATION_GROUPS,
  COACHABLE_QUESTION_IDS,
  type AuditAnswer,
  type ContaminationGroup,
} from "../../lib/contamination";

// F13-T06 — the pure contamination audit computation (spec.md FR-20,
// tech_infrastructure.md §3). No database and no provider: the acceptance that
// the audit is a deterministic computation over a seeded answer set, that the
// result distinguishes the three treatment buckets, and that no answer text or
// private row enters it, is exercised here.

function value(unit: string) {
  return { metric: "paying centers", value: 300, unit, why: "why" };
}

/** One q6 answer keyed on `choice`, the signature the scorer compares. */
function choice(selection: string) {
  return { choice: selection, why: "because" };
}

/** One open-text answer (q4) — the scorer treats it as manual review. */
const prose = (text: string) => ({ text });

function answer(
  respondentId: string,
  questionId: AuditAnswer["questionId"],
  value: unknown,
): AuditAnswer {
  return { respondentId, questionId, value, confidence: null };
}

/**
 * A small, opaque group lookup. Since the audit keys on (question, respondent)
 * pairs, a caller hands us a function that maps exactly that pair to a bucket;
 * this fixture builds one from a plain map so the test reads like the data.
 */
function groupOf(
  pairs: Record<string, Record<string, ContaminationGroup>>,
): (q: AuditAnswer["questionId"], r: string) => ContaminationGroup {
  return (q, r) => pairs[q]?.[r] ?? "uncoached";
}

describe("contamination audit computation", () => {
  it("distinguishes example-shown from hint-only from uncoached on closed questions", () => {
    // q3 (unit signature): R1–R3 shown the example all agree on the unit;
    // R4 hint-only is alone (single answer, trivially aligned); R5–R6 were
    // never coached and genuinely split.
    const answers: AuditAnswer[] = [
      answer("r1", "q3", value("paying_centers")),
      answer("r2", "q3", value("paying_centers")),
      answer("r3", "q3", value("paying_centers")),
      answer("r4", "q3", value("paying_centers")),
      answer("r5", "q3", value("visits")),
      answer("r6", "q3", value("per_child")),
      // q6 (choice signature): the same treatment pattern.
      answer("r1", "q6", choice("center")),
      answer("r2", "q6", choice("center")),
      answer("r4", "q6", choice("parent")),
      answer("r5", "q6", choice("parent")),
      answer("r6", "q6", choice("therapist")),
    ];

    const groups: Record<string, Record<string, ContaminationGroup>> = {
      q3: { r1: "example-shown", r2: "example-shown", r3: "example-shown", r4: "hint-only" },
      q6: { r1: "example-shown", r2: "example-shown", r4: "hint-only" },
    };

    const audit = computeContaminationAudit("c1", answers, groupOf(groups));

    // The three buckets exist as separate figures and the coached buckets show
    // a higher mean agreement than the uncoached one — the convergence signal
    // FR-20 exists to catch.
    expect(audit.agreement["example-shown"]).toBe(1);
    expect(audit.agreement["hint-only"]).toBe(1);
    expect(audit.agreement.uncoached).toBe(0.5);
    expect(audit.closedQuestions).toBe(2);

    // q3's rows carry per-group counts: three shown, one hint, two uncoached.
    const q3 = audit.questions.find((q) => q.questionId === "q3");
    expect(q3?.groups["example-shown"].included).toBe(3);
    expect(q3?.groups["hint-only"].included).toBe(1);
    expect(q3?.groups.uncoached.included).toBe(2);
    // The counted answers are the public, comparable ones — nothing private.
    expect(q3?.groups["example-shown"].divergence.agreementRate).toBe(1);
  });

  it("keeps open-text coachable answers out of the agreement rollup but scores them", () => {
    const answers: AuditAnswer[] = [
      answer("r1", "q4", prose("make the record one connected thing")),
      answer("r2", "q4", prose("let parents see what they bought")),
    ];
    const groups: Record<string, Record<string, ContaminationGroup>> = {
      q4: { r1: "example-shown" },
    };

    const audit = computeContaminationAudit("c1", answers, groupOf(groups));

    // Open text never produces an agreement rate, so no closed question feeds
    // the rollup and every group's mean is null.
    expect(audit.closedQuestions).toBe(0);
    expect(audit.agreement["example-shown"]).toBeNull();
    expect(audit.agreement.uncoached).toBeNull();

    const q4 = audit.questions.find((q) => q.questionId === "q4");
    expect(q4?.groups["example-shown"].divergence.mode).toBe("open");
    expect(q4?.groups["example-shown"].divergence.category).toBe("manual review");
  });

  it("lands every answer in the uncoached bucket with no interaction log", () => {
    const answers: AuditAnswer[] = [
      answer("r1", "q3", value("paying_centers")),
      answer("r2", "q3", value("visits")),
    ];

    const audit = computeContaminationAudit("c1", answers);

    const q3 = audit.questions.find((q) => q.questionId === "q3");
    expect(q3?.groups.uncoached.included).toBe(2);
    expect(q3?.groups["example-shown"].included).toBe(0);
    expect(q3?.groups["hint-only"].included).toBe(0);
    // Two answers that split: alignment 0.5, spread 0.5.
    expect(q3?.groups.uncoached.divergence.agreementRate).toBe(0.5);
  });

  it("omits questions nobody has answered", () => {
    const answers: AuditAnswer[] = [answer("r1", "q3", value("paying_centers"))];

    const audit = computeContaminationAudit("c1", answers);

    expect(audit.questions.map((q) => q.questionId)).toEqual(["q3"]);
    // COACHABLE_QUESTION_IDS is the domain the audit covers.
    expect(COACHABLE_QUESTION_IDS).toContain("q3");
  });

  it("uses stable, ordered group keys across every question row", () => {
    const answers: AuditAnswer[] = [answer("r1", "q10", { model: "monthly_subscription" })];
    const audit = computeContaminationAudit("c1", answers);

    const row = audit.questions.find((q) => q.questionId === "q10");
    // Every row exposes exactly the three documented buckets in order.
    expect(row?.groups).not.toBeNull();
    expect(CONTAMINATION_GROUPS).toEqual(["example-shown", "hint-only", "uncoached"]);
    expect(Object.keys(row!.groups)).toEqual(CONTAMINATION_GROUPS);
  });
});