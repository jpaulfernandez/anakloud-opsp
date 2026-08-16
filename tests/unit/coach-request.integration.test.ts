import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer, type Q14AnswerValue } from "../../lib/answers";
import { loadCoachRequest } from "../../lib/coach-request";
import { buildCoachMessages } from "../../lib/coach-prompt";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F13-T02 acceptance against a real Postgres — the three criteria, each as a
// captured-coach-call:
//
//   - "a test captures the outbound payload and asserts absence of name, id,
//     email and any second answer" — seed a respondent with several answers,
//     load one, and assert the built payload carries only that one;
//   - "q14d content never appears in a captured payload, including when Q14 is
//     itself evaluated" — load Q14 and assert the private note (stored in its
//     own is_private row) is excluded at the query boundary;
//   - "two consecutive calls share no conversational state" — each load builds
//     a fresh single-message payload.
//
// Like the other DB suites it runs only when `DATABASE_URL` set AND
// `RUN_DB_TESTS=1`; it SKIPs by default so `./verify.sh` stays green without a
// database. Each run works in its own temporary schema and drops it after.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "55555555-5555-5555-5555-555555555555";
const RESPONDENT = "66666666-6666-6666-6666-666666666666";
const NAME = "Maria Dela Cruz";
const EMAIL = "maria@anakloud.ph";

/** The coachable answer being evaluated. */
const Q3_VALUE = {
  metric: "centers onboarded",
  value: 40,
  unit: "per year",
  why: "scale",
};

/** A second answer by the same respondent — must never appear in the Q3 payload. */
const Q7_VALUE = { text: "a different promise entirely" };

/** A Q14 that carries a private note, which must never reach any coach payload. */
const Q14_INPUT: Q14AnswerValue = {
  wants: [],
  others: {},
  hours: 12,
  private_note: "I may need to leave in six months.",
};

describe.skipIf(!enabled)("coach payload minimisation against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `coach_request_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code)
       values ($1, $2, $3, $4, 'token-coach', 'ABCDEF')`,
      [RESPONDENT, COHORT, NAME, EMAIL],
    );

    await withRespondentContext(db!, RESPONDENT, async (tx) => {
      await upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q3",
        value: Q3_VALUE,
        confidence: 4,
      });
      await upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q7",
        value: Q7_VALUE,
        confidence: 3,
      });
      await upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q14",
        value: Q14_INPUT,
      });
    });
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  /** The full captured outbound payload for one coach call. */
  async function capturePayload(questionId: "q3" | "q7" | "q14") {
    return withRespondentContext(db!, RESPONDENT, async (tx) => {
      const ctx = await loadCoachRequest(tx, RESPONDENT, questionId);
      const payload = buildCoachMessages(ctx);
      return { ctx, payload, userTurn: payload.messages[0].content };
    });
  }

  it("the outbound payload carries only question metadata and the one answer", async () => {
    const { ctx, userTurn } = await capturePayload("q3");

    // Question metadata and the single answer under evaluation, rendered to text.
    expect(userTurn).toContain(`Question: ${ctx.questionText}`);
    expect(userTurn).toContain(`Helper: ${ctx.helper}`);
    expect(userTurn).toContain("Answer:\ncenters onboarded: 40 per year — scale");

    // No name, no email, no respondent id anywhere in the payload.
    for (const secret of [NAME, EMAIL, RESPONDENT]) {
      expect(userTurn, secret).not.toContain(secret);
    }
  });

  it("no second answer leaks into the payload", async () => {
    const { userTurn } = await capturePayload("q3");
    // Q7's answer is the same respondent's other answer: it must not appear
    // while Q3 is evaluated.
    expect(userTurn).not.toContain(Q7_VALUE.text);
  });

  it("q14d content never appears, even when Q14 itself is evaluated", async () => {
    const { userTurn } = await capturePayload("q14");

    // The private note lives on its own row excluded by the query, so neither
    // its text nor its field name reaches the payload.
    expect(userTurn).not.toContain(Q14_INPUT.private_note);
    expect(userTurn).not.toContain("private_note");

    // The public half of Q14 still renders (the note is absent, not the answer).
    expect(userTurn).toContain("Wants to own: none");
    expect(userTurn).toContain("Hours a week: 12");
  });

  it("two consecutive calls share no conversational state and see exactly one answer", async () => {
    const first = await capturePayload("q3");
    const second = await capturePayload("q3");

    // Each call is a single-message, self-contained payload with no accumulated
    // history, and the same question resolves identically in isolation.
    expect(first.payload.messages).toHaveLength(1);
    expect(second.payload.messages).toHaveLength(1);
    expect(second.userTurn).toBe(first.userTurn);
  });
});