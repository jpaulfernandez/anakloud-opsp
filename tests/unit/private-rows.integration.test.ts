import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildAiPayload,
  listFacilitatorAnswers,
  listPublicAnswers,
  upsertAnswer,
  type Q14AnswerValue,
} from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F01-T03 acceptance covers the write split and private exclusion at the query
// layer. These need a real Postgres, so like the migration tests they run only
// when the operator opts in: `DATABASE_URL` set AND `RUN_DB_TESTS=1`. They
// SKIP by default, keeping `./verify.sh` green without a database. Each run
// works inside its own temporary schema and drops it afterwards.
const SPLIT_INPUT = {
  wants: ["sales", "fundraise"],
  others: { "44444444-4444-4444-4444-444444444444": "product" },
  hours: 12,
  private_note: "I may need to leave in six months.",
} as const;

const PUBLIC_ONLY: Omit<Q14AnswerValue, "private_note"> = {
  wants: ["sales", "fundraise"],
  others: { "44444444-4444-4444-4444-444444444444": "product" },
  hours: 12,
};

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "55555555-5555-5555-5555-555555555555";
const RESPONDENT = "66666666-6666-6666-6666-666666666666";

describe.skipIf(!enabled)("Q14 private-row separation against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `private_rows_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent', 'token-q14', 'ABCDEF')`,
      [RESPONDENT, COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("writes Q14 as two rows: a public `q14` and a private `q14d`", async () => {
    await upsertAnswer(db!, {
      respondent_id: RESPONDENT,
      question_id: "q14",
      value: SPLIT_INPUT,
    });

    const { rows } = await db!.query(
      `select question_id, is_private, value
         from answers
        where respondent_id = $1
        order by question_id`,
      [RESPONDENT],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.question_id)).toEqual(["q14", "q14d"]);

    const publicRow = rows.find((r) => r.question_id === "q14")!;
    expect(publicRow.is_private).toBe(false);
    expect(publicRow.value).toEqual(PUBLIC_ONLY);

    const privateRow = rows.find((r) => r.question_id === "q14d")!;
    expect(privateRow.is_private).toBe(true);
    expect(privateRow.value).toEqual({ private_note: SPLIT_INPUT.private_note });
  });

  it("never nests the private note inside the q14 payload", async () => {
    const { rows } = await db!.query(
      "select value from answers where respondent_id = $1 and question_id = 'q14'",
      [RESPONDENT],
    );
    expect(rows[0].value).not.toHaveProperty("private_note");
  });

  it("upserting Q14 again replaces both rows without leaving stale data", async () => {
    await upsertAnswer(db!, {
      respondent_id: RESPONDENT,
      question_id: "q14",
      value: {
        wants: ["sales"],
        others: {},
        hours: 20,
        private_note: "Updated: I'm staying.",
      },
    });

    const { rows } = await db!.query(
      `select question_id, is_private, value
         from answers
        where respondent_id = $1
        order by question_id`,
      [RESPONDENT],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.question_id === "q14").value.hours).toBe(20);
    expect(rows.find((r) => r.question_id === "q14d").value).toEqual({
      private_note: "Updated: I'm staying.",
    });
  });

  it("excludes the private note from the export helper", async () => {
    const answers = await listPublicAnswers(db!, RESPONDENT);
    expect(answers.some((a) => a.question_id === "q14")).toBe(true);
    expect(answers.some((a) => a.question_id === "q14d")).toBe(false);
    expect(answers.find((a) => a.question_id === "q14")?.value).not.toHaveProperty(
      "private_note",
    );
  });

  it("excludes the private note from the PDF helper", async () => {
    const answers = await listPublicAnswers(db!, RESPONDENT);
    expect(answers.some((a) => a.question_id === "q14d")).toBe(false);
    expect(
      JSON.stringify(answers.map((a) => a.value)).includes("I'm staying."),
    ).toBe(false);
  });

  it("excludes the private note from the AI payload builder", async () => {
    const payload = await buildAiPayload(db!, RESPONDENT);
    expect(payload.some((e) => e.question_id === "q14")).toBe(true);
    expect(payload.some((e) => e.question_id === "q14d")).toBe(false);

    // Payload carries question metadata + answer text only, no row/respondent ids.
    const keys = new Set(Object.keys(payload[0]));
    expect(keys).toEqual(new Set(["question_id", "value"]));
    expect(payload.find((e) => e.question_id === "q14")?.value).not.toHaveProperty(
      "private_note",
    );
  });

  it("returns the private note on the facilitator read path only", async () => {
    const all = await listFacilitatorAnswers(db!, COHORT);
    const privateRow = all.find((a) => a.question_id === "q14d");
    expect(privateRow).toBeDefined();
    expect(privateRow!.value).toEqual({ private_note: "Updated: I'm staying." });
  });

  it("does not split non-Q14 answers", async () => {
    await upsertAnswer(db!, {
      respondent_id: RESPONDENT,
      question_id: "q7",
      value: { text: "one priority" },
      confidence: 4,
    });

    const { rows } = await db!.query(
      "select question_id, is_private, confidence from answers where question_id = 'q7'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].is_private).toBe(false);
    expect(rows[0].confidence).toBe(4);

    const answers = await listPublicAnswers(db!, RESPONDENT);
    expect(answers.find((a) => a.question_id === "q7")?.value).toEqual({
      text: "one priority",
    });
  });
});