import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  fetchContaminationAudit,
  type ContaminationGroup,
} from "../../lib/contamination";
import { logCoachInteraction, setExampleShown } from "../../lib/interactions";
import { seedCohort, SEED_COHORT_ID, SEED_RESPONDENTS } from "../../lib/seed";

// F13-T06 — the contamination audit against a real Postgres (spec.md FR-20,
// tech_infrastructure.md §3). Runs only when opted in (DATABASE_URL set AND
// RUN_DB_TESTS=1), otherwise SKIPS, inside a temporary schema it drops
// afterwards — the same pattern as the other DB tests.
//
// Proves the acceptance criteria that need a database: the audit runs against
// an answer set written through the real write path and returns a comparable
// figure; the result distinguishes example-shown from hint-only from uncoached
// on the same question; it is still computable once the cohort has completed;
// and it runs against the actual seed cohort. No provider is ever imported or
// called anywhere in this path, so prodcing the audit involves no AI call.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "dddd1111-dddd-1111-dddd-111111111461";
const FACILITATOR = "dddd1111-dddd-1111-dddd-111111111462";
const ANA = "dddd1111-dddd-1111-dddd-111111111463";
const BEN = "dddd1111-dddd-1111-dddd-111111111464";
const CARLA = "dddd1111-dddd-1111-dddd-111111111465";
const DIEGO = "dddd1111-dddd-1111-dddd-111111111466";
const ELENA = "dddd1111-dddd-1111-dddd-111111111467";

const HINT = "Make the metric something you could point at.";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

/** Write one answer to one respondent in their own RLS context. */
async function write(
  respondentId: string,
  questionId: string,
  value: object,
) {
  await withRespondentContext(db!, respondentId, (tx) =>
    upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: questionId,
      value,
      confidence: null,
    }),
  );
}

/** Seed answers on q3 (closed, unit signature) and q6 (closed, choice). */
async function writeAnswers() {
  const q3 = (unit: string) => ({ metric: "paying centers", value: 300, unit, why: "why" });
  const q6 = (choice: string) => ({ choice, why: "because" });

  // Example-shown camp is unanimous; hint-only and uncoached split apart.
  await write(ANA, "q3", q3("paying_centers"));
  await write(BEN, "q3", q3("paying_centers"));
  await write(CARLA, "q3", q3("visits"));
  await write(DIEGO, "q3", q3("visits"));
  await write(ELENA, "q3", q3("per_child"));

  await write(ANA, "q6", q6("center"));
  await write(BEN, "q6", q6("center"));
  await write(CARLA, "q6", q6("parent"));
  await write(DIEGO, "q6", q6("parent"));
  await write(ELENA, "q6", q6("therapist"));
}

/** Log a coach row for a respondent, marking it example-shown when asked. */
async function coach(respondentId: string, questionId: string, example: boolean) {
  await logCoachInteraction(db!, respondentId, {
    question_id: questionId,
    attempt_no: 1,
    verdict: "needs_work",
    hint_text: HINT,
    example_shown: false,
    level: "L2",
  });
  if (example) await setExampleShown(db!, respondentId, questionId);
}

async function groupsIn(audit: {
  questions: Array<{ questionId: string; groups: Record<ContaminationGroup, { included: number }> }>;
}) {
  const out: Record<string, Record<ContaminationGroup, number>> = {};
  for (const q of audit.questions) {
    out[q.questionId] = {
      "example-shown": q.groups["example-shown"].included,
      "hint-only": q.groups["hint-only"].included,
      uncoached: q.groups.uncoached.included,
    };
  }
  return out;
}

describe.skipIf(!enabled)("contamination audit against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `contamination_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );

    const respondent = (id: string, name: string, fac = false) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, COHORT, name, `token-${id}`, name.slice(0, 6).toUpperCase(), fac],
      );

    await respondent(FACILITATOR, "Lia", true);
    await respondent(ANA, "Ana");
    await respondent(BEN, "Ben");
    await respondent(CARLA, "Carla");
    await respondent(DIEGO, "Diego");
    await respondent(ELENA, "Elena");

    await writeAnswers();

    // ANA + BEN saw the shared example on q3 and q6; CARLA got a hint only.
    await coach(ANA, "q3", true);
    await coach(BEN, "q3", true);
    await coach(CARLA, "q3", false);
    await coach(ANA, "q6", true);
    await coach(BEN, "q6", true);
    await coach(CARLA, "q6", false);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("returns a comparable figure and distinguishes the three treatment buckets", async () => {
    const audit = await fetchContaminationAudit(db!, FACILITATOR, COHORT);

    // Comparable headline: coached buckets converged (mean agreement 1), the
    // never-coached bucket split (agreement 0.5 on both closed questions).
    expect(audit.agreement["example-shown"]).toBe(1);
    expect(audit.agreement["hint-only"]).toBe(1);
    expect(audit.agreement.uncoached).toBe(0.5);
    expect(audit.closedQuestions).toBe(2);

    const groups = await groupsIn(audit);
    expect(groups.q3).toEqual({
      "example-shown": 2,
      "hint-only": 1,
      uncoached: 2,
    });
    expect(groups.q6).toEqual({
      "example-shown": 2,
      "hint-only": 1,
      uncoached: 2,
    });
    // Open-text coachable questions are scored too, but never move the rollup.
    expect(groups.q4).toBeUndefined(); // nobody answered q4 in this fixture
  });

  it("is computable against a completed (historical) cohort", async () => {
    await db!.query(`update cohorts set status = 'closed' where id = $1`, [COHORT]);

    const audit = await fetchContaminationAudit(db!, FACILITATOR, COHORT);
    expect(audit.agreement.uncoached).toBe(0.5);
    expect(audit.closedQuestions).toBe(2);
  });

  it("runs against the real seeded cohort and yields a comparable figure", async () => {
    // The audit is cohort-parameterised: seed the actual fixture cohort (all
    // answers uncoached) and read it back through the same deterministic path.
    await seedCohort(db!);
    const audit = await fetchContaminationAudit(db!, SEED_RESPONDENTS[5]!.id, SEED_COHORT_ID);

    // Seed has no coach rows, so everything falls into the uncoached bucket and
    // the closed coachable questions still yield an agreement figure.
    expect(audit.cohortId).toBe(SEED_COHORT_ID);
    expect(audit.closedQuestions).toBeGreaterThan(0);
    expect(typeof audit.agreement.uncoached).toBe("number");
    const groups = await groupsIn(audit);
    for (const q of ["q3", "q4", "q6", "q7", "q9", "q10", "q11"]) {
      expect(groups[q].uncoached).toBeGreaterThan(0);
      expect(groups[q]["example-shown"] + groups[q]["hint-only"]).toBe(0);
    }
  });
});