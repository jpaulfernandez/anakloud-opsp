import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  acceptOfficialCellDraft,
  discardOfficialCellDraft,
  getOrCreateOfficialDraft,
  NoOfficialDraftPendingError,
  storeOfficialCellDraft,
  type OfficialCellDraft,
} from "../../lib/official-opsp";
import { latestOfficialDraft } from "../../lib/official-opsp";

// F15-T04 acceptance against a real Postgres — the draft lifecycle (FR-40):
// an AI-drafted statement is stored on the cell as a pending draft while the
// published value stays untouched; acceptance is an explicit, separate action
// that promotes it as ink; declining drops it without writing anything. Like
// the other DB suites these skip unless the operator opts in (DATABASE_URL set
// AND RUN_DB_TESTS=1) and assert as a non-superuser role so RLS is applied.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = randomUUID();
const FACILITATOR = randomUUID();

describe.skipIf(!enabled)("official synthesis draft lifecycle (F15-T04)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_draft_test_${Date.now()}`;
    role = `app_draft_test_${Date.now()}`;

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
       values ($1, $2, 'Facilitator', 'token-draft-fac', 'DFAC01', true)`,
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

  it("stores a draft without touching the cell's published value (acceptance: visibly a draft)", async () => {
    await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);

    const pending: OfficialCellDraft = {
      id: randomUUID(),
      statement: "Win the centres first; the parent is the reason we are here.",
      sourceQuestionIds: ["q6"],
    };
    const stored = await storeOfficialCellDraft(db!, FACILITATOR, COHORT, "bhag", pending);

    const cell = stored.cells.bhag;
    // The draft is present, and the official value is still null — the
    // statement has not entered the plan.
    expect(cell.draft).toEqual(pending);
    expect(cell.value).toBeNull();

    // Persisted across a fresh read of the same lineage.
    const read = await withRespondentContext(db!, FACILITATOR, (tx) =>
      latestOfficialDraft(tx, COHORT),
    );
    expect(read?.cells.bhag.draft).toEqual(pending);
  });

  it("accepting is an explicit separate action: it alone promotes the statement as ink", async () => {
    const accepted = await acceptOfficialCellDraft(db!, FACILITATOR, COHORT, "bhag");

    const cell = accepted.cells.bhag;
    expect(cell.value).toBe("Win the centres first; the parent is the reason we are here.");
    expect(cell.marking).toEqual({ type: "single", mark: "ink" });
    expect(cell.sources).toEqual(["q6"]);
    // The draft is consumed — nothing is pending any more.
    expect(cell.draft).toBeUndefined();

    // The accepted content survives a reload, and no draft is pending.
    const read = await withRespondentContext(db!, FACILITATOR, (tx) =>
      latestOfficialDraft(tx, COHORT),
    );
    expect(read?.cells.bhag.value).toContain("Win the centres first");
    expect(read?.cells.bhag.draft).toBeUndefined();
  });

  it("discarding a draft clears it without promoting anything", async () => {
    // Draft again, then decline.
    await storeOfficialCellDraft(db!, FACILITATOR, COHORT, "purpose", {
      id: randomUUID(),
      statement: "Never final on its own.",
      sourceQuestionIds: ["q4"],
    });

    const declined = await discardOfficialCellDraft(db!, FACILITATOR, COHORT, "purpose");
    expect(declined.cells.purpose.draft).toBeUndefined();
    // Nothing entered the plan: the value is still blank.
    expect(declined.cells.purpose.value).toBeNull();

    const read = await withRespondentContext(db!, FACILITATOR, (tx) =>
      latestOfficialDraft(tx, COHORT),
    );
    expect(read?.cells.purpose.draft).toBeUndefined();
  });

  it("accept/discard refuse when there is no pending draft", async () => {
    await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    await expect(acceptOfficialCellDraft(db!, FACILITATOR, COHORT, "purpose")).rejects.toThrow(
      NoOfficialDraftPendingError,
    );
    await expect(discardOfficialCellDraft(db!, FACILITATOR, COHORT, "purpose")).rejects.toThrow(
      NoOfficialDraftPendingError,
    );
  });
});