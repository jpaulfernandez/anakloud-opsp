import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate, rollbackMigration } from "../../lib/migrate";

// These acceptance tests need a real Postgres and are destructive, so they run
// only when the operator opts in: `DATABASE_URL` set AND `RUN_DB_TESTS=1`.
// They SKIP by default, which keeps `./verify.sh` green without a database.
// Every test works inside its own temporary schema and drops it afterwards,
// so a dev database is never clobbered.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "11111111-1111-1111-1111-111111111111";
const RESPONDENT = "22222222-2222-2222-2222-222222222222";

describe.skipIf(!enabled)("migrations against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `migration_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("applies the migrations to an empty Postgres", async () => {
    await migrate(db!);
    const { rows } = await db!.query(`
      select table_name from information_schema.tables
      where table_schema = $1
    `, [schemaName]);
    const tables = rows.map((r) => r.table_name).sort();
    expect(tables).toEqual([
      "ai_budget",
      "ai_interactions",
      "answer_snapshots",
      "answers",
      "cohorts",
      "opsp_drafts",
      "respondents",
      "schema_migrations",
    ]);
  });

  it("is idempotent: applying twice creates no duplicate migrations", async () => {
    await migrate(db!);
    const { rows } = await db!.query(
      "select count(*)::int as n from schema_migrations",
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects a second answer with the same (respondent_id, question_id)", async () => {
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent', 'token-a', 'ABCDEF')`,
      [RESPONDENT, COHORT],
    );

    const insertAnswer = () =>
      db!.query(
        `insert into answers (id, respondent_id, question_id, value)
         values ($1, $2, 'q1', $3::jsonb)`,
        ["33333333-3333-3333-3333-333333333333", RESPONDENT, JSON.stringify({ text: "x" })],
      );

    await insertAnswer();
    await expect(insertAnswer()).rejects.toMatchObject({
      code: "23505", // unique_violation
    });
  });

  it("rolls the migration back cleanly", async () => {
    await migrate(db!);
    await rollbackMigration(db!, "0001_core_schema");

    const { rows } = await db!.query(`
      select table_name from information_schema.tables
      where table_schema = $1
    `, [schemaName]);
    expect(rows.map((r) => r.table_name)).toEqual(["schema_migrations"]);

    const { rows: migRows } = await db!.query(
      "select count(*)::int as n from schema_migrations",
    );
    expect(migRows[0].n).toBe(0);
  });
});