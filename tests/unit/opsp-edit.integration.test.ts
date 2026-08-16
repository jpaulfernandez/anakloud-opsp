import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { performSubmit } from "../../lib/submit";
import {
  createOpspDraftVersion,
  OpspDraftNotFoundError,
} from "../../lib/opsp-edit";
import { latestIndividualDraft } from "../../lib/opsp-draft";
import { type OpspCell, type OpspCellId } from "../../lib/opsp";

// F07-T05 OPSP editing and versioning against a real Postgres. Runs only when
// opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside
// a temporary schema it drops afterwards — the same pattern as the other DB
// tests. Exercises the two load-bearing claims of the ticket:
//
//   * Editing a cell creates a new opsp_drafts version and leaves every prior
//     version intact (FR-26, acceptance: "editing three cells produces new
//     versions with prior versions intact").
//   * Editing an OPSP cell never writes to the answers table (PR5, acceptance:
//     "the OPSP edit route cannot write to answers").
//
// The edit route is a thin wrapper over createOpspDraftVersion; these tests
// call the function directly and assert answers are untouched, matching how the
// other DB tests exercise performSubmit.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111261";
const FACILITATOR = "aaaa1111-aaaa-1111-aaaa-111111111262";
const RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111263";
const UNSKIPPED_RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111264";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

const Q1_VALUE = { text: "Movement data is locked inside notebooks." };

/** Seed a respondent's answers (q1 with a confidence, q14 with its private note). */
async function seedAnswers(respondentId: string, confidence = 3) {
  await withRespondentContext(db!, respondentId, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: "q1",
      value: Q1_VALUE,
      confidence,
    });
    await upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: "q14",
      value: {
        wants: ["product"],
        others: {},
        hours: 20,
        private_note: "worried about the runway",
      },
    });
  });
}

/** A respondent's answer rows and snapshot payload, read as the facilitator. */
async function answerState(respondentId: string) {
  return withRespondentContext(db!, FACILITATOR, async (tx) => {
    const answers = await tx.query<{
      question_id: string;
      value: unknown;
      confidence: number | null;
      is_private: boolean;
    }>(
      `select question_id, value, confidence, is_private
         from answers where respondent_id = $1 order by question_id`,
      [respondentId],
    );
    const snaps = await tx.query<{ payload: unknown }>(
      `select payload from answer_snapshots where respondent_id = $1`,
      [respondentId],
    );
    return {
      answers: answers.rows,
      firstSnapshotPayload: snaps.rows[0]?.payload ?? null,
    };
  });
}

/** The respondent's latest draft cells, read as themselves (their own draft). */
async function latestCells(respondentId: string): Promise<Record<OpspCellId, OpspCell>> {
  return withRespondentContext(db!, respondentId, async (tx) => {
    const draft = await latestIndividualDraft(tx);
    if (!draft) throw new Error("expected a draft");
    return draft.cells;
  });
}

describe.skipIf(!enabled)("OPSP editing and versioning against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `opsp_edit_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    const insertRespondent = (id: string, invite: string, code: string, fac = false) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, COHORT, fac ? "Facilitator" : "Respondent", invite, code, fac],
      );
    await insertRespondent(FACILITATOR, "token-opsp-fac", "FACEB", true);
    await insertRespondent(RESPONDENT, "token-opsp-a", "OPAA01");
    await insertRespondent(UNSKIPPED_RESPONDENT, "token-opsp-b", "OPBB02");
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("editing three cells produces three new versions with prior versions intact", async () => {
    await seedAnswers(RESPONDENT);
    await performSubmit(db!, RESPONDENT, COHORT);

    // v1 exists from submit, holding every cell that has content.
    const before = await latestCells(RESPONDENT);
    expect(before.purpose.value).not.toBeNull();
    expect(before.capacity.value).toEqual({ q14: { hours: 20 } });

    // Three sequential edits, each writing a new version that carries the
    // prior edits forward (each builds on the latest cells).
    const e1 = await createOpspDraftVersion(db!, RESPONDENT, COHORT, {
      cellId: "purpose",
      content: "Every child seen, every week.",
    });
    const e2 = await createOpspDraftVersion(db!, RESPONDENT, COHORT, {
      cellId: "capacity",
      content: "Twenty hours a week, no more.",
    });
    const e3 = await createOpspDraftVersion(db!, RESPONDENT, COHORT, {
      cellId: "core_values",
      content: "",
      mark: "pencil",
    });

    expect(e1.version).toBe(2);
    expect(e2.version).toBe(3);
    expect(e3.version).toBe(4);

    // All four versions are present, ordered 1..4 — nothing was overwritten.
    const drafts = await withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query<{ version: number; cells: unknown }>(
        `select version, cells from opsp_drafts
          where owner_type = 'individual' and owner_id = $1 order by version`,
        [RESPONDENT],
      );
      return rows.map((r) => ({ version: r.version, cells: r.cells as Record<OpspCellId, OpspCell> }));
    });
    expect(drafts.map((d) => d.version)).toEqual([1, 2, 3, 4]);

    // Prior versions are intact: v1 is the unedited submit cells, and each new
    // version preserves the edits made before it.
    expect(drafts[0].cells).toEqual(before);
    expect(drafts[1].cells.purpose.value).toBe("Every child seen, every week.");
    expect(drafts[2].cells.purpose.value).toBe("Every child seen, every week.");
    expect(drafts[2].cells.capacity.value).toBe("Twenty hours a week, no more.");
    // Third edit cleared core_values (empty string → null) and set a mark.
    expect(drafts[3].cells.core_values.value).toBeNull();
    expect(drafts[3].cells.core_values.marking).toEqual({ type: "single", mark: "pencil" });
    // The purpose and capacity edits survive into version 4.
    expect(drafts[3].cells.purpose.value).toBe("Every child seen, every week.");
    expect(drafts[3].cells.capacity.value).toBe("Twenty hours a week, no more.");

    // The latest view reads version 4.
    const latest = await latestCells(RESPONDENT);
    expect((await latestIndividualDraftRaw(RESPONDENT)).version).toBe(4);
    expect(latest.purpose.value).toBe("Every child seen, every week.");
  });

  it("editing an OPSP cell never writes to the answers table", async () => {
    // This respondent was submitted and edited in the previous test. Capture
    // the answers and the frozen snapshot, run more edits, and assert both are
    // byte-for-byte unchanged and the draft count grew by exactly the edits.
    const before = await answerState(RESPONDENT);
    const beforeDrafts = await draftCount();

    await createOpspDraftVersion(db!, RESPONDENT, COHORT, {
      cellId: "purpose",
      content: "A different purpose, still answers untouched.",
    });
    await createOpspDraftVersion(db!, RESPONDENT, COHORT, {
      cellId: "swt_threats",
      mark: "ink",
    });

    const after = await answerState(RESPONDENT);
    expect(after.answers).toEqual(before.answers);
    // The frozen snapshot payload is identical — editing never re-derives or
    // re-stamps the baseline of record.
    expect(JSON.stringify(after.firstSnapshotPayload)).toBe(
      JSON.stringify(before.firstSnapshotPayload),
    );
    // Three answer rows exist (q1, q14, and the private q14d note) and not one
    // was added, changed or removed by the edits.
    expect(after.answers).toHaveLength(3);

    // Only the two edit operations added rows, each a new draft version.
    expect(await draftCount()).toBe(beforeDrafts + 2);
  });

  it("a mark-only edit changes the mark and leaves the cell content untouched", async () => {
    const who = UNSKIPPED_RESPONDENT;
    await seedAnswers(who, 3);
    await performSubmit(db!, who, COHORT);

    const before = await latestCells(who);
    const capacity = before.capacity;
    await createOpspDraftVersion(db!, who, COHORT, {
      cellId: "capacity",
      mark: "ink",
    });
    const after = await latestCells(who);
    expect(after.capacity.marking).toEqual({ type: "single", mark: "ink" });
    // The content was untouched: still the structured hours fragment.
    expect(after.capacity.value).toEqual(capacity.value);
  });

  it("throws OpspDraftNotFoundError for a respondent with no draft", async () => {
    // This spec's submitted respondents all have a draft, so use a respondent
    // that never answered at all — an unsubmitted respondent has no draft to
    // edit.
    const fresh = "aaaa1111-aaaa-1111-aaaa-111111111265";
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Never Answered', 'token-opsp-c', 'OPCC03')`,
      [fresh, COHORT],
    );
    await expect(
      createOpspDraftVersion(db!, fresh, COHORT, { cellId: "purpose", content: "x" }),
    ).rejects.toThrow(OpspDraftNotFoundError);
  });

  /** Raw latest-draft read, returning id + version (used to assert version). */
  async function latestIndividualDraftRaw(
    respondentId: string,
  ): Promise<{ id: string; version: number }> {
    return withRespondentContext(db!, respondentId, async (tx) => {
      const draft = await latestIndividualDraft(tx);
      if (!draft) throw new Error("expected a draft");
      return { id: draft.id, version: draft.version };
    });
  }

  /** Count all individual draft versions for RESPONDENT, read as facilitator. */
  async function draftCount(): Promise<number> {
    return withRespondentContext(db!, FACILITATOR, async (tx) => {
      const { rows } = await tx.query(
        `select count(*)::int as n from opsp_drafts
          where owner_type = 'individual' and owner_id = $1`,
        [RESPONDENT],
      );
      return rows[0].n as number;
    });
  }
});