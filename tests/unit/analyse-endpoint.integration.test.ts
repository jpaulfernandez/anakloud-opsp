import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer, type Q14AnswerValue } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { loadAnalysisScoring } from "../../lib/analyse-endpoint";

// F14-T02 acceptance 1 over a real Postgres: the deterministic scoring the
// endpoint serves with the AI unavailable (the key-removed L2 path) must be a
// correct divergence breakdown, computed from the same public read helpers that
// keep the Q14(d) private note out of every export and AI payload (F01-T03).
//
// Runs only when DATABASE_URL and RUN_DB_TESTS are set — SKIPs by default so
// `./verify.sh` stays green without a database, in its own temporary schema.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "99887766-1234-4321-abcd-998877665544";
const FACILITATOR = "89000000-0000-0000-0000-000000000091";
const R1 = "71000000-0000-0000-0000-000000000091";
const R2 = "71000000-0000-0000-0000-000000000092";

// A hard split on Q8: opposite first wedges, both at confidence 5.
const R1_Q8 = {
  rank: ["pedconnect", "teachday", "parentup", "fourth_app"],
  delete: "fourth_app",
  why: "the referral is the scarce resource",
  predicted: ["teachday", "pedconnect", "parentup", "fourth_app"],
};
const R2_Q8 = {
  rank: ["teachday", "pedconnect", "parentup", "fourth_app"],
  delete: "fourth_app",
  why: "centers hold the money and the daily pain",
  predicted: ["pedconnect", "teachday", "parentup", "fourth_app"],
};
const R1_Q1 = { text: "waiting stops being why a child misses care" };
const R2_Q1 = { text: "progress visible so families know what they buy" };
const R1_Q14: Q14AnswerValue = {
  wants: ["product"],
  others: {},
  hours: 30,
  private_note: "I may need to leave in six months.",
};
const R2_Q14: Q14AnswerValue = {
  wants: ["backend"],
  others: {},
  hours: 20,
  private_note: "I have been assuming everyone else is full-time.",
};

describe.skipIf(!enabled)("deterministic analysis scoring against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `analyse_scoring_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    for (const [id, isFac, token, resume] of [
      [R1, false, "token-scr-r1", "SCRR1"],
      [R2, false, "token-scr-r2", "SCRR2"],
      [FACILITATOR, true, "token-scr-fac", "SCRRF"],
    ] as const) {
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, COHORT, `Scorer ${id.slice(-2)}`, `${id.slice(-2)}@example.ph`, token, resume, isFac],
      );
    }
    await withRespondentContext(db!, R1, async (tx) => {
      await upsertAnswer(tx, { respondent_id: R1, question_id: "q1", value: R1_Q1 });
      await upsertAnswer(tx, { respondent_id: R1, question_id: "q8", value: R1_Q8, confidence: 5 });
      await upsertAnswer(tx, { respondent_id: R1, question_id: "q14", value: R1_Q14 });
    });
    await withRespondentContext(db!, R2, async (tx) => {
      await upsertAnswer(tx, { respondent_id: R2, question_id: "q1", value: R2_Q1 });
      await upsertAnswer(tx, { respondent_id: R2, question_id: "q8", value: R2_Q8, confidence: 5 });
      await upsertAnswer(tx, { respondent_id: R2, question_id: "q14", value: R2_Q14 });
    });
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("single-question scope scores the question deterministically", async () => {
    const scoring = await loadAnalysisScoring(db!, FACILITATOR, COHORT, "q8");
    expect(scoring.scope).toBe("question");
    expect(scoring.questionId).toBe("q8");
    expect(scoring.results).toHaveLength(1);
    const r = scoring.results[0]!;
    expect(r.questionId).toBe("q8");
    expect(r.mode).toBe("closed");
    expect(r.included).toBe(2);
    // Opposite orders at full confidence → the sharpest divergence verdict.
    expect(r.category).toBe("hard split");
    expect(r.agreementRate).toBe(0.5);
    expect(r.meanConfidence).toBe(5);
  });

  it("cohort scope returns one result per answered question in registry order", async () => {
    const scoring = await loadAnalysisScoring(db!, FACILITATOR, COHORT, null);
    expect(scoring.scope).toBe("cohort");
    expect(scoring.questionId).toBeNull();
    expect(scoring.results.map((r) => r.questionId)).toEqual(["q1", "q8", "q14"]);
  });

  it("the Q14(d) private note is structurally absent — it is not a scored question and leaks no content", async () => {
    const scoring = await loadAnalysisScoring(db!, FACILITATOR, COHORT, null);
    // q14d lives in its own is_private row under a question id that is not in
    // the registry, so it can never become a scoring result, and it is dropped
    // at the query layer from the public reads — the note is absent structurally.
    expect(scoring.results.some((r) => (r.questionId as string) === "q14d")).toBe(false);

    const q14 = scoring.results.find((r) => r.questionId === "q14")!;
    // The public half of Q14 is scored; the private note can neither bump a
    // privateExcluded count (it is a different question row) nor leak text.
    expect(q14.privateExcluded).toBe(0);
    expect(JSON.stringify(scoring)).not.toContain(R1_Q14.private_note);
    expect(JSON.stringify(scoring)).not.toContain(R2_Q14.private_note);
    expect(JSON.stringify(scoring)).not.toContain("private_note");
  });

  it("every scored row carries the export options for the L2/L3 panel", async () => {
    const scoring = await loadAnalysisScoring(db!, FACILITATOR, COHORT, "q1");
    expect(scoring.exportOptions).toEqual({
      csv: "/api/admin/export",
      projection: "/admin/projection",
    });
  });
});