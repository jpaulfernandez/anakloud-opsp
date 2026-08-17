import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  acceptOfficialCellDraft,
  buildOfficialCellConflict,
  discardOfficialCellDraft,
  getOrCreateOfficialDraft,
  NoOfficialConflictError,
  NoOfficialDraftPendingError,
  recordOfficialCellDecision,
  storeOfficialCellConflict,
  storeOfficialCellDraft,
  UnknownConflictPositionError,
  type OfficialCellDraft,
  type OfficialSourceCard,
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

describe.skipIf(!enabled)("official conflict result state (F15-T05)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";
  const COHORT = randomUUID();
  const FACILITATOR = randomUUID();

  const CENTRE = "They pay, and if they churn there is no data for the parent to look at anyway.";
  const PARENT = "The parent is the human we are actually here for; everything else is infrastructure.";

  const POSITIONS: OfficialSourceCard[] = [
    { id: "p-centre", respondentId: randomUUID(), respondentName: "Centre Camp", questionId: "q6", text: CENTRE },
    { id: "p-parent", respondentId: randomUUID(), respondentName: "Parent Camp", questionId: "q6", text: PARENT },
  ];

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_conflict_test_${Date.now()}`;
    role = `app_conflict_test_${Date.now()}`;

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
       values ($1, $2, 'Facilitator', 'token-conflict-fac', 'CFAC01', true)`,
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

  it("stores a conflict without touching the cell's published value", async () => {
    await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    const conflict = buildOfficialCellConflict(
      POSITIONS,
      "These say opposite things about who the core customer is.",
    );
    const stored = await storeOfficialCellConflict(db!, FACILITATOR, COHORT, "bhag", conflict);

    const cell = stored.cells.bhag;
    expect(cell.conflict).toEqual(conflict);
    // The value stays blank until a decision is recorded — nothing is merged in.
    expect(cell.value).toBeNull();

    const read = await withRespondentContext(db!, FACILITATOR, (tx) =>
      latestOfficialDraft(tx, COHORT),
    );
    expect(read?.cells.bhag.conflict?.positions).toHaveLength(2);
    expect(read?.cells.bhag.value).toBeNull();
  });

  it("recording a decision stores the chosen position and the decider as the note", async () => {
    const { cells } = await recordOfficialCellDecision(
      db!,
      FACILITATOR,
      COHORT,
      "bhag",
      "p-parent",
    );

    const cell = cells.bhag;
    // The chosen position becomes the cell content as ink, seeded with its
    // provenance, and the note keeps which position and by whom (F15-T05).
    expect(cell.value).toBe(PARENT);
    expect(cell.marking).toEqual({ type: "single", mark: "ink" });
    expect(cell.sources).toEqual(["q6"]);
    expect(cell.conflict?.decision).toMatchObject({
      positionId: "p-parent",
      chosenText: PARENT,
      recorderId: FACILITATOR,
      recorderName: "Facilitator",
    });
    expect(typeof cell.conflict?.decision?.recordedAt).toBe("string");

    // Both positions remain visible after the decision is recorded.
    expect(cell.conflict?.positions).toHaveLength(2);
    expect(cell.conflict?.positions.map((p) => p.id)).toEqual(["p-centre", "p-parent"]);
    expect(cell.conflict?.positions.map((p) => p.text)).toContain(CENTRE);
    expect(cell.conflict?.positions.map((p) => p.text)).toContain(PARENT);

    // The decision survives a reload of the same lineage.
    const read = await withRespondentContext(db!, FACILITATOR, (tx) =>
      latestOfficialDraft(tx, COHORT),
    );
    expect(read?.cells.bhag.value).toBe(PARENT);
    expect(read?.cells.bhag.conflict?.decision?.positionId).toBe("p-parent");
    expect(read?.cells.bhag.conflict?.decision?.recorderName).toBe("Facilitator");
  });

  it("refuses to record a second decision once one is already recorded", async () => {
    await expect(
      recordOfficialCellDecision(db!, FACILITATOR, COHORT, "bhag", "p-centre"),
    ).rejects.toThrow(NoOfficialConflictError);
  });

  it("refuses a record-decision when the cell has no conflict or no draft", async () => {
    await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    // "purpose" has no conflict on it yet.
    await expect(
      recordOfficialCellDecision(db!, FACILITATOR, COHORT, "purpose", "p-centre"),
    ).rejects.toThrow(NoOfficialConflictError);
  });

  it("refuses a decision for a position that is not one of the conflict's positions", async () => {
    await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
    // A fresh, undecided conflict on "purpose" so the position check is reached.
    const fresh = buildOfficialCellConflict(
      POSITIONS,
      "These say opposite things about the core customer.",
    );
    await storeOfficialCellConflict(db!, FACILITATOR, COHORT, "purpose", fresh);
    await expect(
      recordOfficialCellDecision(db!, FACILITATOR, COHORT, "purpose", "not-a-position"),
    ).rejects.toThrow(UnknownConflictPositionError);
  });
});