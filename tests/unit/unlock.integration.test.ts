import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { performSubmit } from "../../lib/submit";
import { performUnlock, RespondentNotInCohortError } from "../../lib/unlock";

// F06-T05 facilitator unlock with audit against a real Postgres. Runs only when
// opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// Covers the ticket's acceptances: unlocking then re-submitting yields two
// snapshot rows both intact, unlocked_by names the facilitator who acted, the
// unlock never touches the existing snapshot (the "SHALL NOT modify or delete
// the existing answer_snapshots row" clause), and a target outside the
// facilitator's cohort is refused.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111271";
const OTHER_COHORT = "aaaa1111-aaaa-1111-aaaa-111111111272";
const FACILITATOR = "aaaa1111-aaaa-1111-aaaa-111111111273";
const RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111274";
const RESPONDENT_CROSS_COHORT = "aaaa1111-aaaa-1111-aaaa-111111111275";
const RESPONDENT_UNSUBMITTED = "aaaa1111-aaaa-1111-aaaa-111111111276";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

/** A respondent writes one of their own answers (their RLS context). */
async function seedAnswer(respondentId: string, questionId: string, text: string) {
  await withRespondentContext(db!, respondentId, (tx) =>
    upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: questionId,
      value: { text },
    }),
  );
}

/** Snapshot payloads for one respondent, read as the facilitator (RLS-bypass). */
async function snapshotPayloads(respondentId: string) {
  return withRespondentContext(db!, FACILITATOR, async (tx) => {
    const { rows } = await tx.query(
      "select payload from answer_snapshots where respondent_id = $1 order by taken_at, id",
      [respondentId],
    );
    return rows.map((r: { payload: unknown }) => JSON.stringify(r.payload));
  });
}

/** The respondent's lock and audit state, read as the facilitator. */
async function auditState(respondentId: string) {
  return withRespondentContext(db!, FACILITATOR, async (tx) => {
    const { rows } = await tx.query(
      `select submitted_at, unlocked_by, unlocked_at
         from respondents where id = $1`,
      [respondentId],
    );
    const r = rows[0];
    return {
      submittedAt: r?.submitted_at ?? null,
      unlockedBy: r?.unlocked_by ?? null,
      unlockedAt: r?.unlocked_at ?? null,
    };
  });
}

describe.skipIf(!enabled)("facilitator unlock with audit against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `unlock_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    const insertCohort = (id: string) =>
      db!.query(
        "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
        [id],
      );
    await insertCohort(COHORT);
    await insertCohort(OTHER_COHORT);

    const insertRespondent = (
      id: string,
      cohort: string,
      invite: string,
      code: string,
      fac = false,
    ) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, cohort, fac ? "Facilitator" : "Respondent", invite, code, fac],
      );
    await insertRespondent(FACILITATOR, COHORT, "token-unlock-fac", "FACUN", true);
    await insertRespondent(RESPONDENT, COHORT, "token-unlock-a", "UNA01");
    await insertRespondent(RESPONDENT_CROSS_COHORT, OTHER_COHORT, "token-unlock-b", "UNB02");
    await insertRespondent(RESPONDENT_UNSUBMITTED, COHORT, "token-unlock-c", "UNC03");
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("unlocking then re-submitting yields two snapshot rows, both intact", async () => {
    await seedAnswer(RESPONDENT, "q1", "First submission of the baseline.");
    await performSubmit(db!, RESPONDENT, COHORT);

    const beforeUnlock = await snapshotPayloads(RESPONDENT);
    expect(beforeUnlock).toHaveLength(1);

    const unlock = await performUnlock(db!, FACILITATOR, COHORT, RESPONDENT);
    expect(unlock.unlocked).toBe(true);

    // The unlock must not touch the frozen snapshot (SHALL NOT modify or delete).
    expect(await snapshotPayloads(RESPONDENT)).toEqual(beforeUnlock);

    // The respondent is reopened, edits, and re-submits.
    await seedAnswer(RESPONDENT, "q1", "Second submission after the unlock.");
    await performSubmit(db!, RESPONDENT, COHORT);

    const after = await snapshotPayloads(RESPONDENT);
    expect(after).toHaveLength(2);
    // The original snapshot is preserved byte-identical alongside the new one.
    expect(after[0]).toBe(beforeUnlock[0]);
    expect(JSON.parse(after[1])).toMatchObject({
      q1: { value: { text: "Second submission after the unlock." }, is_private: false },
    });
  });

  it("records unlocked_by as the facilitator who acted", async () => {
    // RESPONDENT was re-submitted in the previous test, so unlock a locked row.
    await performUnlock(db!, FACILITATOR, COHORT, RESPONDENT);

    const state = await auditState(RESPONDENT);
    expect(state.submittedAt).toBeNull();
    expect(state.unlockedBy).toBe(FACILITATOR);
    expect(state.unlockedAt).not.toBeNull();
  });

  it("unlocking an already-unsubmitted respondent is a no-op that does not re-stamp the audit", async () => {
    const result = await performUnlock(db!, FACILITATOR, COHORT, RESPONDENT_UNSUBMITTED);
    expect(result.unlocked).toBe(false);

    const state = await auditState(RESPONDENT_UNSUBMITTED);
    expect(state.unlockedBy).toBeNull();
    expect(state.unlockedAt).toBeNull();
  });

  it("refuses a respondent outside the facilitator's cohort", async () => {
    await expect(
      performUnlock(db!, FACILITATOR, COHORT, RESPONDENT_CROSS_COHORT),
    ).rejects.toBeInstanceOf(RespondentNotInCohortError);
  });
});