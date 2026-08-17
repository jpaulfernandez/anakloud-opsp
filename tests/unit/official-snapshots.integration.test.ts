import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  createOfficialDraftVersion,
  getOfficialSnapshot,
  getOrCreateOfficialDraft,
  listOfficialSnapshots,
  takeOfficialSnapshot,
} from "../../lib/official-opsp";

// F15-T07 acceptance against a real Postgres: named version snapshots of the
// official OPSP, and the immutability rule — taking a snapshot and continuing
// to edit leaves the snapshot unchanged. The immutability holds structurally
// (every official write is a new `opsp_drafts` insert, never an update), and
// these tests pin that the snapshot row and its cells never change once taken,
// and that history lists snapshots (labelled versions) but not plain working
// versions. Like the other DB suites these skip unless the operator opts in
// (DATABASE_URL set AND RUN_DB_TESTS=1) and assert as a non-superuser role so
// RLS is actually enforced.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "44444444-4444-4444-4444-444444444444";
const FACILITATOR = "33333333-3333-3333-3333-333333333333";

describe.skipIf(!enabled)("official OPSP snapshots (F15-T07)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_snapshot_test_${Date.now()}`;
    role = `app_snapshot_test_${Date.now()}`;

    await db!.query(`create schema ${schemaName}`);
    await db!.query(`set search_path = ${schemaName}, public`);

    await migrate(db!);
    await db!.query(`create role ${role}`);
    await db!.query(`grant usage on schema ${schemaName} to ${role}`);
    await db!.query(
      `grant select, insert, update, delete on all tables in schema ${schemaName} to ${role}`,
    );

    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Team', 'Q4 2026', 'open')`,
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', 'token-snapshot-fac', 'OSN01', true)`,
      [FACILITATOR, COHORT],
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

  it("records a named snapshot as a new labelled version of the official plan", async () => {
    // Ensure the version-1 blank baseline exists, then author something so the
    // snapshot is not of an untouched canvas.
    const base = await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    expect(base.version).toBe(1);
    await createOfficialDraftVersion(db!, FACILITATOR, COHORT, {
      cellId: "bhag",
      content: "One live record for every child.",
      mark: "ink",
    });

    // The snapshot stores the current (v2) cells under the label as v3.
    const snapshot = await takeOfficialSnapshot(
      db!,
      FACILITATOR,
      COHORT,
      "Q4 2026 v1",
    );
    expect(snapshot.label).toBe("Q4 2026 v1");
    expect(snapshot.version).toBe(3);
    expect(snapshot.cells.bhag.value).toBe("One live record for every child.");
  });

  it("lists only labelled snapshots in history, newest first, and fetches one by version", async () => {
    const snapshots = await listOfficialSnapshots(db!, FACILITATOR, COHORT);
    // Only the one labelled snapshot appears; the version-1 baseline and the
    // plain edit version (v2) have null labels and are not history entries.
    expect(snapshots.map((s) => s.label)).toEqual(["Q4 2026 v1"]);

    const fetched = await getOfficialSnapshot(
      db!,
      FACILITATOR,
      COHORT,
      snapshots[0].version,
    );
    expect(fetched?.label).toBe("Q4 2026 v1");

    // A working version (no label) is not a snapshot and does not resolve.
    const working = await getOfficialSnapshot(db!, FACILITATOR, COHORT, 2);
    expect(working).toBeNull();
  });

  it("an edit after the snapshot leaves the snapshot unchanged", async () => {
    const before = await getOfficialSnapshot(db!, FACILITATOR, COHORT, 3);

    // Keep editing the working plan: reauthor the same cell as a new version.
    await createOfficialDraftVersion(db!, FACILITATOR, COHORT, {
      cellId: "bhag",
      content: "Two live records for every family.",
      mark: "ink",
    });

    const after = await getOfficialSnapshot(db!, FACILITATOR, COHORT, 3);
    expect(after?.version).toBe(before?.version);
    expect(after?.label).toBe(before?.label);
    // The snapshot's cells are frozen at what they were — the edit moved on.
    expect(after?.cells.bhag.value).toBe("One live record for every child.");
  });

  it("the snapshot write goes through the official authoring path (no answers write)", async () => {
    // A snapshot is an `opsp_drafts` insert; the answers table is untouched.
    await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(
        `select count(*)::int as n from answers`,
      );
      expect(rows[0].n).toBe(0);
      const { rows: snap } = await tx.query<{ label: string | null }>(
        `select label from opsp_drafts
          where owner_type = 'official' and cohort_id = $1 and label is not null`,
        [COHORT],
      );
      expect(snap.length).toBeGreaterThan(0);
      for (const row of snap) expect(row.label).toBeTruthy();
    });
  });
});