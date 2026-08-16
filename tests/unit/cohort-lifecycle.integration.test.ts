import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withRespondentContext } from "../../lib/access";
import { listPublicAnswers, upsertAnswer } from "../../lib/answers";
import {
  CohortNameMismatchError,
  deleteCohort,
  fetchCohortLive,
  resolveServedLevel,
  setCohortLevelPin,
  setCohortStatus,
} from "../../lib/cohort-lifecycle";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { createSessionToken, resolveSession } from "../../lib/session";
import { performSubmit } from "../../lib/submit";

// F09-T05 — the cohort lifecycle against a real Postgres. Runs only when opted
// in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// Exercises the acceptances that need a database:
//   1. Closing a cohort flips sessions to read-only while answer reads keep
//      working (OPSP/PDF access stays intact — covered end to end in e2e).
//   2. Cohort deletion leaves no orphaned answers, snapshots, drafts,
//      interactions or budget rows, and a wrong name confirmation deletes
//      nothing.
//   3. A level pin persists and resolves on the next request without a
//      redeploy.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "cccc1111-cccc-1111-cccc-111111110101";
const FACILITATOR = "cccc1111-cccc-1111-cccc-111111110102";
const RESPONDENT = "cccc1111-cccc-1111-cccc-111111110103";

const COHORT_DEL = "cccc1111-cccc-1111-cccc-111111110104";
const FAC_DEL = "cccc1111-cccc-1111-cccc-111111110105";
const R1_DEL = "cccc1111-cccc-1111-cccc-111111110106";
const R2_DEL = "cccc1111-cccc-1111-cccc-111111110107";

const COHORT_WRONG = "cccc1111-cccc-1111-cccc-111111110108";
const FAC_WRONG = "cccc1111-cccc-1111-cccc-111111110109";
const RW_WRONG = "cccc1111-cccc-1111-cccc-111111110110";

const COHORT_NONFAC = "cccc1111-cccc-1111-cccc-111111110111";
const NONFAC_ACTOR = "cccc1111-cccc-1111-cccc-111111110112"; // not a facilitator
const OTHER_NONFAC = "cccc1111-cccc-1111-cccc-111111110113";

const COHORT_NAME = "Anakloud Q4 2026";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

async function insertCohort(id: string, status = "open") {
  await db!.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, $2, 'Q4 2026', $3)`,
    [id, COHORT_NAME, status],
  );
}

async function insertRespondent(
  id: string,
  cohort: string,
  name: string,
  code: string,
  isFac = false,
) {
  await db!.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, $3, $4, $5, $6)`,
    [id, cohort, name, `lctx-${id.replace(/-/g, "")}`, code, isFac],
  );
}

/** Give a respondent one answer plus a frozen snapshot + OPSP draft (submit). */
async function seedSubmittedRespondent(respondentId: string, cohortId: string) {
  await withRespondentContext(db!, respondentId, (tx) =>
    upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: "q1",
      value: { text: "a baseline answer that must not orphan" },
    }),
  );
  await performSubmit(db!, respondentId, cohortId);
}

/** Count dependent rows that should all be gone after a cascade delete. */
async function dependentRows(cohortId: string) {
  const cohort = await db!.query("select count(*)::int as n from cohorts where id = $1", [
    cohortId,
  ]);
  const respondents = await db!.query(
    "select count(*)::int as n from respondents where cohort_id = $1",
    [cohortId],
  );
  const answers = await db!.query(
    `select count(*)::int as n from answers
      where respondent_id in (select id from respondents where cohort_id = $1)`,
    [cohortId],
  );
  const snapshots = await db!.query(
    `select count(*)::int as n from answer_snapshots
      where respondent_id in (select id from respondents where cohort_id = $1)`,
    [cohortId],
  );
  const drafts = await db!.query(
    "select count(*)::int as n from opsp_drafts where cohort_id = $1",
    [cohortId],
  );
  const interactions = await db!.query(
    `select count(*)::int as n from ai_interactions
      where respondent_id in (select id from respondents where cohort_id = $1)`,
    [cohortId],
  );
  const budget = await db!.query(
    "select count(*)::int as n from ai_budget where cohort_id = $1",
    [cohortId],
  );
  return {
    cohort: cohort.rows[0].n,
    respondents: respondents.rows[0].n,
    answers: answers.rows[0].n,
    snapshots: snapshots.rows[0].n,
    drafts: drafts.rows[0].n,
    interactions: interactions.rows[0].n,
    budget: budget.rows[0].n,
  };
}

describe.skipIf(!enabled)("cohort lifecycle against a real Postgres", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret";
    db = createDbClient();
    await db.connect();
    schemaName = `cohort_lifecycle_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("moves the cohort between draft, open and closed and persists the change", async () => {
    await insertCohort(COHORT);
    await insertRespondent(FACILITATOR, COHORT, "Lia", "LCLF1", true);
    await insertRespondent(RESPONDENT, COHORT, "Norm", "LCLN1");

    await setCohortStatus(db!, COHORT, "draft");
    expect((await fetchCohortLive(db!, COHORT))!.status).toBe("draft");

    await setCohortStatus(db!, COHORT, "open");
    expect((await fetchCohortLive(db!, COHORT))!.status).toBe("open");

    await setCohortStatus(db!, COHORT, "closed");
    expect((await fetchCohortLive(db!, COHORT))!.status).toBe("closed");
  });

  it("closing a cohort flips sessions to read-only while answer reads keep working", async () => {
    await seedSubmittedRespondent(RESPONDENT, COHORT);

    // Open cohort → not read-only.
    await setCohortStatus(db!, COHORT, "open");
    const openToken = createSessionToken({ respondentId: RESPONDENT, cohortId: COHORT });
    expect((await resolveSession(db!, openToken))!.readOnly).toBe(false);

    // Closed cohort → admitted, read-only; the answers are still readable.
    await setCohortStatus(db!, COHORT, "closed");
    const closedToken = createSessionToken({ respondentId: RESPONDENT, cohortId: COHORT });
    const closed = await resolveSession(db!, closedToken);
    expect(closed).not.toBeNull();
    expect(closed!.readOnly).toBe(true);

    // The read path (ui_ux: OPSP and PDF stay accessible when closed) still
    // resolves the respondent's own answers after the cohort closes.
    const answers = await listPublicAnswers(db!, RESPONDENT);
    expect(answers.map((a) => a.question_id)).toContain("q1");
  });

  it("pins the AI level, and 'auto' clears it", async () => {
    await setCohortLevelPin(db!, COHORT, "L2");
    expect((await fetchCohortLive(db!, COHORT))!.aiLevelPin).toBe("L2");

    await setCohortLevelPin(db!, COHORT, "L0");
    expect((await fetchCohortLive(db!, COHORT))!.aiLevelPin).toBe("L0");

    await setCohortLevelPin(db!, COHORT, "auto");
    expect((await fetchCohortLive(db!, COHORT))!.aiLevelPin).toBeNull();
  });

  it("a level pin resolves on the next request without a redeploy", async () => {
    // Boot default in local/preview is L2. Pinning L3 should win immediately —
    // no redeploy, because the pin is read live from the cohorts row.
    await setCohortLevelPin(db!, COHORT, "L3");
    const pinned = await fetchCohortLive(db!, COHORT);
    expect(resolveServedLevel("L2", pinned!.aiLevelPin)).toBe("L3");

    // Leaving it automatic falls back to the boot default.
    await setCohortLevelPin(db!, COHORT, "auto");
    const auto = await fetchCohortLive(db!, COHORT);
    expect(resolveServedLevel("L2", auto!.aiLevelPin)).toBe("L2");
  });

  it("deletion is one action that cascades to every dependent row", async () => {
    await insertCohort(COHORT_DEL);
    await insertRespondent(FAC_DEL, COHORT_DEL, "Fac", "LDLF1", true);
    await insertRespondent(R1_DEL, COHORT_DEL, "R One", "LDLR1");
    await insertRespondent(R2_DEL, COHORT_DEL, "R Two", "LDLR2");

    // Answers, a snapshot + OPSP draft (via submit), an interaction and a
    // budget row — everything a cohort can own.
    await seedSubmittedRespondent(R1_DEL, COHORT_DEL);
    await withRespondentContext(db!, R2_DEL, (tx) =>
      upsertAnswer(tx, {
        respondent_id: R2_DEL,
        question_id: "q7",
        value: { text: "a second baseline answer" },
      }),
    );
    await db!.query(
      `insert into ai_interactions (id, respondent_id, purpose, level)
       values ($1, $2, 'coach', 'L2')`,
      [randomUUID(), R1_DEL],
    );
    await db!.query(
      `insert into ai_budget (cohort_id, input_cap, output_cap, input_used, output_used)
       values ($1, 100, 100, 10, 20)`,
      [COHORT_DEL],
    );

    expect(Object.values(await dependentRows(COHORT_DEL)).some((n) => n > 0)).toBe(true);

    await deleteCohort(db!, FAC_DEL, COHORT_DEL, COHORT_NAME);

    const after = await dependentRows(COHORT_DEL);
    expect(after).toEqual({
      cohort: 0,
      respondents: 0,
      answers: 0,
      snapshots: 0,
      drafts: 0,
      interactions: 0,
      budget: 0,
    });
  });

  it("a wrong name confirmation deletes nothing", async () => {
    await insertCohort(COHORT_WRONG);
    await insertRespondent(FAC_WRONG, COHORT_WRONG, "Fac", "LWNF1", true);
    await insertRespondent(RW_WRONG, COHORT_WRONG, "R Wrong", "LWNR1");
    await seedSubmittedRespondent(RW_WRONG, COHORT_WRONG);

    await expect(
      deleteCohort(db!, FAC_WRONG, COHORT_WRONG, "Some other name"),
    ).rejects.toBeInstanceOf(CohortNameMismatchError);

    // Everything is still intact — the mismatch raised before any delete.
    const after = await dependentRows(COHORT_WRONG);
    expect(after.cohort).toBe(1);
    expect(after.respondents).toBe(2);
    expect(after.snapshots).toBe(1);
    expect(after.answers).toBe(1);
    await expect(fetchCohortLive(db!, COHORT_WRONG)).resolves.toEqual(
      expect.objectContaining({ name: COHORT_NAME }),
    );
  });

  it("a non-facilitator cannot delete the cohort", async () => {
    await insertCohort(COHORT_NONFAC);
    await insertRespondent(NONFAC_ACTOR, COHORT_NONFAC, "Norm", "LNF1");
    await insertRespondent(OTHER_NONFAC, COHORT_NONFAC, "Other", "LNF2");

    await expect(
      deleteCohort(db!, NONFAC_ACTOR, COHORT_NONFAC, COHORT_NAME),
    ).rejects.toThrow();
    expect((await dependentRows(COHORT_NONFAC)).cohort).toBe(1);
  });
});