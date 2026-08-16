import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { listPublicAnswers } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  RESPONDENT_IDS,
  SEED_COHORT_ID,
  SEED_RESPONDENTS,
  seedCohort,
} from "../../lib/seed";

// F01-T05 acceptance against a real Postgres. Like the other DB tests it runs
// only when the operator opts in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`),
// SKIPS otherwise, and works inside a temporary schema it drops afterwards.
// The cohort/respondent assertions run directly (those tables are not RLS-
// gated); everything over `answers` runs inside the facilitator's context,
// who sees cohort-wide and can count private rows.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const FACILITATOR_ID = RESPONDENT_IDS.facilitator;

// Each respondent answers q1..q13, q14 (public half) and q15 = 15 public rows.
const PUBLIC_ROWS_PER_RESPONDENT = 15;

describe.skipIf(!enabled)("seed script against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `seed_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await seedCohort(db!);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  const publicRowCount = async (respondentId: string): Promise<number> => {
    return withRespondentContext(db!, FACILITATOR_ID, async (tx) => {
      const { rows } = await tx.query(
        `select count(*)::int as n from answers
          where respondent_id = $1 and is_private = false`,
        [respondentId],
      );
      return rows[0].n;
    });
  };

  const privateRows = async (): Promise<Array<{ respondent_id: string; value: unknown }>> => {
    return withRespondentContext(db!, FACILITATOR_ID, async (tx) => {
      const { rows } = await tx.query(
        `select respondent_id, value from answers
          where question_id = 'q14d' and is_private = true`,
      );
      return rows as Array<{ respondent_id: string; value: { private_note: string } }>;
    });
  };

  it("creates one cohort with six respondents, one of whom is the facilitator", async () => {
    const { rows: cohortRows } = await db!.query(
      "select count(*)::int as n from cohorts",
    );
    expect(cohortRows[0].n).toBe(1);

    const { rows } = await db!.query(
      `select count(*)::int as total,
              count(*) filter (where is_facilitator)::int as facilitators
         from respondents
        where cohort_id = $1`,
      [SEED_COHORT_ID],
    );
    expect(rows[0].total).toBe(6);
    expect(rows[0].facilitators).toBe(1);
  });

  it("writes all fifteen questions for each respondent as 15 public rows", async () => {
    for (const respondent of SEED_RESPONDENTS) {
      const n = await publicRowCount(respondent.id);
      expect(n, `${respondent.display_name} public answer rows`).toBe(
        PUBLIC_ROWS_PER_RESPONDENT,
      );
    }
  });

  it("creates at least two q14d private rows with non-empty notes", async () => {
    const rows = await privateRows();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect((row.value as { private_note: string }).private_note).not.toBe("");
    }
  });

  it("is idempotent: a second run leaves six respondents, not twelve", async () => {
    await seedCohort(db!);

    const { rows } = await db!.query(
      `select count(*)::int as total
         from respondents
        where cohort_id = $1`,
      [SEED_COHORT_ID],
    );
    expect(rows[0].total).toBe(6);

    const { rows: cohortRows } = await db!.query(
      "select count(*)::int as n from cohorts",
    );
    expect(cohortRows[0].n).toBe(1);

    // No duplicated answers after re-running.
    for (const respondent of SEED_RESPONDENTS) {
      const n = await publicRowCount(respondent.id);
      expect(n).toBe(PUBLIC_ROWS_PER_RESPONDENT);
    }
    expect((await privateRows()).length).toBeGreaterThanOrEqual(2);
  });

  it("excludes private rows from the public read path (the CSV/export proxy)", async () => {
    // F10-T05 builds CSV on top of the same public query helper; here we assert
    // the exclusion at the query layer so the seeded q14d rows cannot leak.
    for (const respondent of SEED_RESPONDENTS) {
      const answers = await withRespondentContext(db!, respondent.id, (tx) =>
        listPublicAnswers(tx, respondent.id),
      );
      const qIds = answers.map((a) => a.question_id);
      expect(qIds).not.toContain("q14d");
    }
  });
});