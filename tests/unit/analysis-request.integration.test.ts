import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer, type Q14AnswerValue } from "../../lib/answers";
import { buildAnalysisMessages } from "../../lib/analysis-prompt";
import {
  loadAnalysisForCohort,
  loadAnalysisForQuestion,
} from "../../lib/analysis-request";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F14-T01 acceptance against a real Postgres, each as a captured analysis
// payload, mirroring the F13-T02 coach suite:
//
//   - "a captured payload contains no name, email or respondent id" — seed a
//     facilitator plus two respondents with distinct identities and answers,
//     load a question and the whole cohort, and assert the built payloads carry
//     only the anonymised A/B/C labels;
//   - "q14d content never reaches the provider, verified against seeded private
//     data" — seed Q14 private notes, load Q14 and the whole cohort, and assert
//     neither the note text nor its field name appears in any user turn.
//
// Like the other DB suites it runs only when `DATABASE_URL` is set AND
// `RUN_DB_TESTS=1`; it SKIPs by default so `./verify.sh` stays green without a
// database. Runs in its own temporary schema, dropped after.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "88888888-8888-8888-8888-888888888888";
// Is_facilitator actor whose RLS context makes cohort-wide answers visible.
const FACILITATOR = "89000000-0000-0000-0000-000000000001";
const FACIL_NAME = "Lia Mendoza";
const FACIL_EMAIL = "lia@anakloud.ph";
// Two analysed respondents; ids sort so R1 is always labelled A, R2 labelled B.
const R1 = "71000000-0000-0000-0000-000000000001";
const R1_NAME = "Raya Aquino";
const R1_EMAIL = "raya@example.ph";
const R2 = "71000000-0000-0000-0000-000000000002";
const R2_NAME = "Bobby Tan";
const R2_EMAIL = "bobby@example.ph";

const IDENTITIES = [R1_NAME, R1_EMAIL, R2_NAME, R2_EMAIL, FACIL_NAME, FACIL_EMAIL];

const R1_Q1 = { text: "waiting stops being why a child misses care" };
const R2_Q1 = { text: "progress visible so families know what they buy" };

/** The hard-split door-opener: R1 leads with pedconnect, R2 with teachday. */
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

describe.skipIf(!enabled)("facilitator-analysis payload against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `analysis_request_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    for (const [id, name, email, isFac, token, resume] of [
      [R1, R1_NAME, R1_EMAIL, false, "token-analysis-r1", "RESUME1"],
      [R2, R2_NAME, R2_EMAIL, false, "token-analysis-r2", "RESUME2"],
      [FACILITATOR, FACIL_NAME, FACIL_EMAIL, true, "token-analysis-fac", "RESUME9"],
    ] as const) {
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, COHORT, name, email, token, resume, isFac],
      );
    }

    // Each respondent writes through their own RLS context, including R1/R2's
    // private Q14 notes (split to their own rows by upsertAnswer).
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

  async function loadQuestion(questionId: "q8" | "q14") {
    return loadAnalysisForQuestion(db!, FACILITATOR, COHORT, questionId);
  }

  it("a single-question payload labels respondents A/B/C and carries no identity", async () => {
    const ctx = await loadQuestion("q8");
    const userTurn = buildAnalysisMessages(ctx).messages[0].content;

    // Both positions appear, each under its anonymised label and own words.
    expect(userTurn).toContain(`Question: ${ctx.blocks[0].questionText}`);
    expect(userTurn).toContain("Respondent A:");
    expect(userTurn).toContain("Respondent B:");
    expect(userTurn).toContain(R1_Q8.why);
    expect(userTurn).toContain(R2_Q8.why);

    // The stable label order: R1 (…001) is A, R2 (…002) is B. The answer
    // renders through the display labels ("PedConnect"), so compare folded-case.
    const aLine = userTurn.split("\n").find((l) => l.startsWith("Respondent A:"));
    const bLine = userTurn.split("\n").find((l) => l.startsWith("Respondent B:"));
    expect(aLine!.toLowerCase()).toContain("pedconnect");
    expect(bLine!.toLowerCase()).toContain("teachday");

    // No name, no email, no respondent id anywhere in the captured payload.
    for (const secret of IDENTITIES) {
      expect(userTurn, secret).not.toContain(secret);
    }
    expect(userTurn).not.toContain(R1);
    expect(userTurn).not.toContain(R2);
    expect(userTurn).not.toContain(FACILITATOR);
  });

  it("q14d private notes never appear, even when Q14 is itself analysed", async () => {
    const ctx = await loadQuestion("q14");
    const userTurn = buildAnalysisMessages(ctx).messages[0].content;

    // Both respondents' private notes live in separate is_private rows excluded
    // at the query layer, so neither the text nor the field name reaches the
    // payload — even while the public half of Q14 is analysed.
    expect(userTurn).not.toContain(R1_Q14.private_note);
    expect(userTurn).not.toContain(R2_Q14.private_note);
    expect(userTurn).not.toContain("private_note");

    // The public half of Q14 still renders for both (the note is absent, not
    // the answer).
    expect(userTurn).toContain("Wants to own: product");
    expect(userTurn).toContain("Wants to own: backend");
    expect(userTurn).toContain("Hours a week: 30");
    expect(userTurn).toContain("Hours a week: 20");
  });

  it("the whole-cohort payload groups questions and stays free of identity", async () => {
    const ctx = await loadAnalysisForCohort(db!, FACILITATOR, COHORT);
    const userTurn = buildAnalysisMessages(ctx).messages[0].content;

    // One block per answered question in registry order, both camps under A/B.
    expect(ctx.questionId).toBeNull();
    expect(ctx.blocks.map((b) => b.questionId)).toEqual(["q1", "q8", "q14"]);
    expect(userTurn).toContain(R1_Q1.text);
    expect(userTurn).toContain(R2_Q1.text);
    expect(userTurn).toContain(R1_Q8.why);
    expect(userTurn).toContain(R2_Q8.why);

    for (const secret of IDENTITIES) {
      expect(userTurn, secret).not.toContain(secret);
    }
    expect(userTurn).not.toContain(R1);
    expect(userTurn).not.toContain(R2);
    expect(userTurn).not.toContain(FACILITATOR);
    expect(userTurn).not.toContain(R1_Q14.private_note);
    expect(userTurn).not.toContain(R2_Q14.private_note);
  });
});