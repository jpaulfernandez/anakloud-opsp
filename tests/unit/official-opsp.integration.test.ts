import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  createOfficialDraftVersion,
  emptyOfficialCells,
  getOrCreateOfficialDraft,
} from "../../lib/official-opsp";

// F15-T01 acceptance against a real Postgres: the official OPSP is persisted
// as an `opsp_drafts` row with owner_type = 'official', scoped so a cohort has
// at most one official lineage, and authoring is restricted to the cohort's
// facilitator. Like the other DB suites these skip unless the operator opts in
// (DATABASE_URL set AND RUN_DB_TESTS=1) and assert as a non-superuser role so
// RLS is actually enforced (a superuser bypasses it).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "55555555-5555-5555-5555-555555555555";
const OTHER_COHORT = "66666666-6666-6666-6666-666666666666";
const FACILITATOR = "77777777-7777-7777-7777-777777777777";
const A = "88888888-8888-8888-8888-888888888888";

describe.skipIf(!enabled)("official OPSP draft (F15-T01)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_opsp_test_${Date.now()}`;
    role = `app_official_test_${Date.now()}`;

    await db!.query(`create schema ${schemaName}`);
    await db!.query(`set search_path = ${schemaName}, public`);

    // Build the schema as the connecting owner, then drop to a restricted role
    // so every read/write below is genuinely RLS-enforced.
    await migrate(db!);
    await db!.query(`create role ${role}`);
    await db!.query(`grant usage on schema ${schemaName} to ${role}`);
    await db!.query(
      `grant select, insert, update, delete on all tables in schema ${schemaName} to ${role}`,
    );

    // Seed the people while superuser (cohorts/respondents are not RLS-gated).
    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Team', 'Q4 2026', 'open')`,
      [COHORT],
    );
    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Other', 'Q4 2026', 'open')`,
      [OTHER_COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', 'token-official-fac', 'OFAC01', true)`,
      [FACILITATOR, COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent A', 'token-official-a', 'OA001')`,
      [A, COHORT],
    );

    await db!.query(`set role ${role}`);
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

  it("creates a blank version-1 official draft for the facilitator's cohort", async () => {
    const draft = await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    expect(draft.version).toBe(1);
    expect(draft.id).toBeTruthy();
    expect(Object.keys(draft.cells).length).toBe(Object.keys(emptyOfficialCells()).length);
    // The collaborative plan opens blank: every cell empty, nothing pre-filled.
    for (const cell of Object.values(draft.cells)) expect(cell.value).toBeNull();
  });

  it("is idempotent: a second open returns the same lineage, not a new one", async () => {
    const first = await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    const second = await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    expect(second.version).toBe(first.version);
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from opsp_drafts
          where owner_type = 'official' and cohort_id = $1`,
        [COHORT],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it("persists official drafts as opsp_drafts rows with owner_type='official' and a null owner", async () => {
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query<{
        owner_type: string;
        owner_id: string | null;
        version: number;
      }>(
        `select owner_type, owner_id, version from opsp_drafts
          where cohort_id = $1`,
        [COHORT],
      );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.owner_type).toBe("official");
        expect(row.owner_id).toBeNull();
      }
    });
  });

  it("writes an edit as a new version, leaving prior versions untouched", async () => {
    const base = await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    const edited = await createOfficialDraftVersion(db!, FACILITATOR, COHORT, {
      cellId: "bhag",
      content: "One live record for every child.",
      mark: "ink",
    });
    expect(edited.version).toBe(base.version + 1);
    expect(edited.cells.bhag.value).toBe("One live record for every child.");

    // The previous version row survives intact.
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query<{ version: number; cells: { bhag?: unknown } }>(
        `select version, cells from opsp_drafts
          where owner_type = 'official' and cohort_id = $1
          order by version`,
        [COHORT],
      );
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
      // Version 1 still has its blank cell (value null, not an authored string);
      // version 2 carries the authored text — prior versions are untouched.
      const v1Bhag = rows[0].cells.bhag as unknown as { value: unknown } | null;
      expect(v1Bhag?.value).toBeNull();
      const v2Bhag = rows[1].cells.bhag as unknown as { value: unknown };
      expect(v2Bhag.value).toBe("One live record for every child.");
    });
  });

  it("scopes the official OPSP to one lineage per cohort", async () => {
    // A facilitator-licensed insert of a *second* version-1 root is rejected by
    // the 0011 partial unique index: there can be no second official lineage.
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const attempt = tx.query(
        `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'official', null, 1, $3::jsonb)`,
        ["99999999-9999-9999-9999-9999999999ff", COHORT, JSON.stringify(emptyOfficialCells())],
      );
      await expect(attempt).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("restricts authoring to the cohort's facilitator", async () => {
    // A respondent of the same cohort cannot seed an official version-1 root.
    await withRespondentContext(db!, A, async (tx) => {
      const attempt = tx.query(
        `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
         values ($1, $2, 'official', null, 1, $3::jsonb)`,
        ["99999999-9999-9999-9999-9999999999aa", COHORT, JSON.stringify(emptyOfficialCells())],
      );
      await expect(attempt).rejects.toMatchObject({ code: "42501" });
    });

    // A respondent cannot author an edit to the existing official draft either:
    // RLS makes the official row invisible to them, so the update matches no
    // rows and the draft content is left untouched (not an error, a no-op).
    await withRespondentContext(db!, A, async (tx) => {
      const res = await tx.query(
        `update opsp_drafts set cells = $3::jsonb
          where owner_type = 'official' and cohort_id = $1 and version = $2`,
        [COHORT, 1, JSON.stringify({})],
      );
      expect(res.rowCount).toBe(0);
    });

    // And the respondent cannot even see the official draft (facilitator-only
    // read sits behind drafts_facilitator_read).
    await withRespondentContext(db!, A, async (tx) => {
      const { rows } = await tx.query<{ version: number }>(
        `select version from opsp_drafts
          where owner_type = 'official' and cohort_id = $1`,
        [COHORT],
      );
      expect(rows).toHaveLength(0);
    });
  });

  it("keeps official drafts out of a non-facilitator's getOrCreate call", async () => {
    // Calling the official-draft helper as a non-facilitator is refused by RLS
    // (no drafts_official_* policy admits them), so a respondent can never
    // cause an official lineage to exist for a cohort they do not facilitate.
    await expect(
      getOrCreateOfficialDraft(db!, A, OTHER_COHORT),
    ).rejects.toMatchObject({ code: "42501" });
  });
});