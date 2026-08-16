import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { listPublicAnswers, upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F01-T04 acceptance: row-level security keyed on respondent identity
// (tech_infrastructure.md §9). These run only when the operator opts in
// (`DATABASE_URL` set AND `RUN_DB_TESTS=1`) and skip by default, keeping
// `./verify.sh` green without a database.
//
// RLS does not apply to superusers, so this suite must assert as a
// non-superuser role or the tests would silently pass while reading any row.
// The migrations run as the connecting owner (postgres), then the session
// drops to a restricted role via SET ROLE for every read and write — the same
// posture the application has in production. The owner-bypass is closed by
// FORCE ROW LEVEL SECURITY, asserted directly below.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "99999999-9999-9999-9999-999999999999";
const FACILITATOR = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const B = "cccccccc-cccc-cccc-cccc-cccccccccccc";

describe.skipIf(!enabled)("row-level access policy (F01-T04)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `access_policy_test_${Date.now()}`;
    role = `app_rls_test_${Date.now()}`;

    await db!.query(`create schema ${schemaName}`);
    await db!.query(`set search_path = ${schemaName}, public`);

    // Build the schema as the connecting owner (postgres), then grant the
    // restricted role the table privileges so it can act as a respondent.
    await migrate(db!);
    await db!.query(`create role ${role}`);
    await db!.query(`grant usage on schema ${schemaName} to ${role}`);
    await db!.query(
      `grant select, insert, update, delete on all tables in schema ${schemaName} to ${role}`,
    );

    // Seed the people while superuser (cohorts/respondents are not RLS-gated).
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', 'token-fac', 'FAC999', true)`,
      [FACILITATOR, COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent A', 'token-a', 'AAAAAA')`,
      [A, COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent B', 'token-b', 'BBBBBB')`,
      [B, COHORT],
    );

    // From here the suite acts as the restricted (non-superuser) role, which is
    // what makes every RLS policy below actually enforced.
    await db!.query(`set role ${role}`);

    // Seed answers as their owners: A has a public q1, a public q14 and a
    // private q14d; B has a q1. A also owns one snapshot and one draft.
    await withRespondentContext(db!, A, async (tx) => {
      await upsertAnswer(tx, { respondent_id: A, question_id: "q1", value: { text: "A answer" } });
      await upsertAnswer(tx, {
        respondent_id: A,
        question_id: "q14",
        value: { wants: [], others: {}, hours: 1, private_note: "A's secret" },
      });
    });
    await withRespondentContext(db!, B, async (tx) => {
      await upsertAnswer(tx, { respondent_id: B, question_id: "q1", value: { text: "B answer" } });
    });
    await withRespondentContext(db!, A, async (tx) => {
      await tx.query(
        `insert into answer_snapshots (id, respondent_id, payload)
         values ($1, $2, $3::jsonb)`,
        ["dddddddd-dddd-dddd-dddd-dddddddddddd", A, JSON.stringify({ q1: "A answer" })],
      );
      await tx.query(
        `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'individual', $3, 1, $4::jsonb)`,
        ["eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", COHORT, A, JSON.stringify({})],
      );
    });
  });

  afterAll(async () => {
    try {
      await db?.query(`reset role`);
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
      if (role) await db?.query(`drop role if exists ${role}`);
    } finally {
      await db?.end();
    }
  });

  it("forces row-level security on every gated table", async () => {
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = $1 and c.relname in ('answers', 'answer_snapshots', 'opsp_drafts')
            and c.relforcerowsecurity`,
        [schemaName],
      );
      const forced = rows.map((r) => r.relname).sort();
      expect(forced).toEqual(["answer_snapshots", "answers", "opsp_drafts"]);
    });
  });

  it("restricts a respondent to reading their own answers only, even via raw SQL", async () => {
    await withRespondentContext(db!, A, async (tx) => {
      const own = await tx.query("select question_id from answers where respondent_id = $1", [A]);
      expect(own.rows.map((r) => r.question_id).sort()).toEqual(["q1", "q14"]);

      // B's row exists in the table but is invisible to A: the same query for
      // B, run as A, returns nothing. Without RLS this would leak B's answer.
      const b = await tx.query("select question_id from answers where respondent_id = $1", [B]);
      expect(b.rows).toHaveLength(0);
    });
  });

  it("denies a respondent's own private row on direct select and on the export path", async () => {
    // RLS blocks the private row even for its owner on a raw select...
    await withRespondentContext(db!, A, async (tx) => {
      const { rows } = await tx.query("select question_id from answers");
      expect(rows.map((r) => r.question_id).sort()).toEqual(["q1", "q14"]);
    });

    // ...and the export helper returns no q14d and no private_note.
    await withRespondentContext(db!, A, async (tx) => {
      const answers = await listPublicAnswers(tx, A);
      expect(answers.some((a) => a.question_id === "q14d")).toBe(false);
      expect(JSON.stringify(answers.map((a) => a.value)).includes("A's secret")).toBe(false);
    });
  });

  it("grants the cohort facilitator cohort-wide read, including private rows", async () => {
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query(
        "select question_id from answers order by question_id",
      );
      expect(rows.map((r) => r.question_id)).toEqual(["q1", "q1", "q14", "q14d"]);
    });
  });

  it("rejects writing an answer owned by someone else", async () => {
    await withRespondentContext(db!, A, async (tx) => {
      const attempt = tx.query(
        `insert into answers (id, respondent_id, question_id, value)
         values ($1, $2, 'q2', $3::jsonb)`,
        ["ffffffff-ffff-ffff-ffff-ffffffffffff", B, JSON.stringify({ text: "to B" })],
      );
      await expect(attempt).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("lets a respondent read and write their own answers", async () => {
    await withRespondentContext(db!, A, async (tx) => {
      await upsertAnswer(tx, { respondent_id: A, question_id: "q2", value: { text: "A second" } });
      const { rows } = await tx.query("select question_id from answers where respondent_id = $1", [A]);
      expect(rows.map((r) => r.question_id).sort()).toEqual(["q1", "q14", "q2"]);
    });
  });

  it("scopes answer_snapshots to their owner, with facilitator cohort-wide read", async () => {
    await withRespondentContext(db!, A, async (tx) => {
      const own = await tx.query("select count(*)::int as n from answer_snapshots where respondent_id = $1", [A]);
      expect(own.rows[0].n).toBe(1);
      const b = await tx.query("select count(*)::int as n from answer_snapshots where respondent_id = $1", [B]);
      expect(b.rows[0].n).toBe(0);
    });
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query("select count(*)::int as n from answer_snapshots");
      expect(rows[0].n).toBe(1);
    });
  });

  it("scopes individual opsp_drafts to their owner, with facilitator cohort-wide read", async () => {
    await withRespondentContext(db!, A, async (tx) => {
      const own = await tx.query("select count(*)::int as n from opsp_drafts where owner_id = $1", [A]);
      expect(own.rows[0].n).toBe(1);
      const b = await tx.query("select count(*)::int as n from opsp_drafts where owner_id = $1", [B]);
      expect(b.rows[0].n).toBe(0);

      // A may write another of their own individual drafts.
      await tx.query(
        `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'individual', $3, 2, $4::jsonb)`,
        ["00000000-0000-0000-0000-000000000002", COHORT, A, JSON.stringify({})],
      );
    });
    await withRespondentContext(db!, B, async (tx) => {
      // B cannot write a draft owned by A.
      const attempt = tx.query(
        `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'individual', $3, 1, $4::jsonb)`,
        ["00000000-0000-0000-0000-000000000003", COHORT, A, JSON.stringify({})],
      );
      await expect(attempt).rejects.toMatchObject({ code: "42501" });
    });
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query("select count(*)::int as n from opsp_drafts");
      expect(rows[0].n).toBe(2);
    });
  });
});