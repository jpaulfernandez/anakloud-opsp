import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { listOwnAnswers, listPublicAnswers, upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F04-T01 read path against a real Postgres. Runs only when opted in
// (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests, calling the lib functions directly. The answers table is behind RLS
// (F01-T04), so every operation runs inside withRespondentContext as the actor
// it claims to be: the respondent writes and reads their own answers, the
// facilitator does raw row inspection.
//
// This is F04-T01's q14d wrinkle made concrete: GET /api/answers must return
// the caller's own private note, so listOwnAnswers (through the bounded
// security-definer app_read_own_answers) is the one read that includes private
// rows — while listPublicAnswers, which backs every export/PDF/AI payload,
// still excludes them.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111131";
const RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111132";
const FACILITATOR = "aaaa1111-aaaa-1111-aaaa-111111111133";

const Q14_FULL = {
  wants: ["product", "backend"],
  others: { "44444444-4444-4444-4444-444444444444": "finance" },
  hours: 20,
  private_note: "I may need to leave in six months.",
} as const;

describe.skipIf(!enabled)("own-answers read incl q14d against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `answers_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent', 'token-answers', 'ABCDEF')`,
      [RESPONDENT, COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', 'token-answers-fac', 'FAC123', true)`,
      [FACILITATOR, COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("listOwnAnswers returns the owner's answers including their own q14d", async () => {
    await withRespondentContext(db!, RESPONDENT, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q14",
        value: Q14_FULL,
      }),
    );
    await withRespondentContext(db!, RESPONDENT, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q7",
        value: { text: "one priority" },
        confidence: 4,
      }),
    );

    let own: Awaited<ReturnType<typeof listOwnAnswers>>;
    await withRespondentContext(db!, RESPONDENT, async (tx) => {
      own = await listOwnAnswers(tx);
    });

    const q14q = own!.find((a) => a.question_id === "q14");
    const q14d = own!.find((a) => a.question_id === "q14d");
    const q7 = own!.find((a) => a.question_id === "q7");

    expect((q14q?.value as { hours?: number | string }).hours).toBe(20);
    expect(q7?.value).toEqual({ text: "one priority" });
    expect(q7?.confidence).toBe(4);

    // The whole point of F04-T01's exception: the owner reads back their own
    // private note through this one bounded read path.
    expect(q14d).toBeDefined();
    expect(q14d!.is_private).toBe(true);
    expect(q14d!.value).toEqual({ private_note: Q14_FULL.private_note });
  });

  it("listOwnAnswers never crosses into another respondent's rows", async () => {
    // A second respondent with their own answer; the first's own read must
    // not include it, and the private one is a second q14d that must not
    // surface either.
    const OTHER = "aaaa1111-aaaa-1111-aaaa-111111111134";
    await db!.query(
      `insert into respondents (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Other', 'token-other', 'OTH456')`,
      [OTHER, COHORT],
    );
    await withRespondentContext(db!, OTHER, (tx) =>
      upsertAnswer(tx, {
        respondent_id: OTHER,
        question_id: "q14",
        value: { ...Q14_FULL, private_note: "other's private thought" },
      }),
    );

    let own: Awaited<ReturnType<typeof listOwnAnswers>>;
    await withRespondentContext(db!, RESPONDENT, async (tx) => {
      own = await listOwnAnswers(tx);
    });
    expect(own!.every((a) => a.question_id === "q14" || a.question_id === "q7" || a.question_id === "q14d")).toBe(true);
    expect(own!.filter((a) => a.question_id === "q14d")).toHaveLength(1);
    expect(own!.find((a) => a.question_id === "q14d")!.value).toEqual({
      private_note: Q14_FULL.private_note,
    });
  });

  it("listPublicAnswers still excludes the owner's own private note", async () => {
    // The privacy guarantee for every other path is unchanged: back a
    // respondent reading their own answers through the shared helper and the
    // q14d row is still filtered out at the query layer.
    let publicA: Awaited<ReturnType<typeof listPublicAnswers>> = [];
    await withRespondentContext(db!, RESPONDENT, async (tx) => {
      publicA = await listPublicAnswers(tx, RESPONDENT);
    });
    expect(publicA.some((a) => a.question_id === "q14d")).toBe(false);
    expect(publicA.find((a) => a.question_id === "q14")?.value).not.toHaveProperty(
      "private_note",
    );
  });
});