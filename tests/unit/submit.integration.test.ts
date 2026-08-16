import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { performSubmit } from "../../lib/submit";

// F06-T03 submit, snapshot and OPSP generation against a real Postgres. Runs
// only when opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS
// otherwise, inside a temporary schema it drops afterwards — the same pattern
// as the other DB tests, calling the submit transaction directly. Covers all
// three acceptance criteria: one snapshot and one OPSP draft v1 per submit, a
// failure during OPSP generation rolling the whole thing back (submitted_at
// stays null), and a double-submit creating no duplicate rows.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111251";
const FACILITATOR = "aaaa1111-aaaa-1111-aaaa-111111111252";
const RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111253";
const RESPONDENT_FAIL = "aaaa1111-aaaa-1111-aaaa-111111111254";
const RESPONDENT_DOUBLE = "aaaa1111-aaaa-1111-aaaa-111111111255";

const Q14_FULL = {
  wants: ["product"],
  others: {},
  hours: 20,
  private_note: "worried about the runway",
} as const;

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

/** Seed a respondent with a Q1 answer and a Q14 answer with its private note. */
async function seedAnswers(respondentId: string) {
  await withRespondentContext(db!, respondentId, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: "q1",
      value: { text: "Movement data is locked inside notebooks." },
      confidence: 3,
    });
    await upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: "q14",
      value: { ...Q14_FULL },
    });
  });
}

/** Cohort-wide counts and state, read as the facilitator (RLS cohort-wide read). */
async function cohortState(respondentId: string) {
  return withRespondentContext(db!, FACILITATOR, async (tx) => {
    const raws = await tx.query(
      "select submitted_at from respondents where id = $1",
      [respondentId],
    );
    const snaps = await tx.query(
      `select payload from answer_snapshots where respondent_id = $1`,
      [respondentId],
    );
    const drafts = await tx.query(
      `select version, owner_type, owner_id, cells
         from opsp_drafts where owner_id = $1`,
      [respondentId],
    );
    return {
      submittedAt: raws.rows[0]?.submitted_at ?? null,
      snapshotCount: snaps.rows.length,
      firstSnapshotPayload: snaps.rows[0]?.payload as Record<string, unknown> | undefined,
      drafts: drafts.rows as Array<{
        version: number;
        owner_type: string;
        owner_id: string;
        cells: Record<string, unknown>;
      }>,
    };
  });
}

describe.skipIf(!enabled)("submit, snapshot and OPSP generation against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `submit_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    const insertRespondent = (
      id: string,
      invite: string,
      resumeCode: string,
      fac = false,
    ) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, COHORT, fac ? "Facilitator" : "Respondent", invite, resumeCode, fac],
      );
    await insertRespondent(FACILITATOR, "token-submit-fac", "FACRA", true);
    await insertRespondent(RESPONDENT, "token-submit-a", "SUBA01");
    await insertRespondent(RESPONDENT_FAIL, "token-submit-b", "SUBB02");
    await insertRespondent(RESPONDENT_DOUBLE, "token-submit-c", "SUBC03");
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("produces exactly one snapshot and one OPSP draft at version 1", async () => {
    await seedAnswers(RESPONDENT);

    const result = await performSubmit(db!, RESPONDENT, COHORT);
    expect(result.alreadySubmitted).toBe(false);

    const state = await cohortState(RESPONDENT);
    expect(state.submittedAt).not.toBeNull();
    expect(state.snapshotCount).toBe(1);
    expect(state.drafts).toHaveLength(1);
    expect(state.drafts[0].owner_type).toBe("individual");
    expect(state.drafts[0].owner_id).toBe(RESPONDENT);
    expect(state.drafts[0].version).toBe(1);

    // The frozen payload carries the private q14d note, marked for exclusion.
    const payload = state.firstSnapshotPayload!;
    expect(payload.q1).toMatchObject({ value: { text: "Movement data is locked inside notebooks." }, confidence: 3, is_private: false });
    expect(payload.q14).toMatchObject({ is_private: false });
    expect(payload.q14d).toMatchObject({
      value: { private_note: Q14_FULL.private_note },
      is_private: true,
    });
  });

  it("a forced failure during OPSP generation rolls back the whole submit", async () => {
    await seedAnswers(RESPONDENT_FAIL);

    const boom = () => {
      throw new Error("OPSP mapping failure");
    };

    await expect(performSubmit(db!, RESPONDENT_FAIL, COHORT, boom)).rejects.toThrow(
      "OPSP mapping failure",
    );

    // Nothing was committed: no lock, no snapshot, no draft.
    const state = await cohortState(RESPONDENT_FAIL);
    expect(state.submittedAt).toBeNull();
    expect(state.snapshotCount).toBe(0);
    expect(state.drafts).toHaveLength(0);
  });

  it("double-submit creates no duplicate rows", async () => {
    await seedAnswers(RESPONDENT_DOUBLE);

    const first = await performSubmit(db!, RESPONDENT_DOUBLE, COHORT);
    expect(first.alreadySubmitted).toBe(false);

    const second = await performSubmit(db!, RESPONDENT_DOUBLE, COHORT);
    expect(second.alreadySubmitted).toBe(true);

    const state = await cohortState(RESPONDENT_DOUBLE);
    expect(state.submittedAt).not.toBeNull();
    expect(state.snapshotCount).toBe(1);
    expect(state.drafts).toHaveLength(1);
  });
});