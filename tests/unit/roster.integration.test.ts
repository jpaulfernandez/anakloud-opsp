import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { performUnlock } from "../../lib/unlock";
import { performSubmit } from "../../lib/submit";
import { fetchRoster, ROSTER_TOTAL_QUESTIONS } from "../../lib/roster";

// F09-T03 — the roster data path against a real Postgres. Runs only when opted
// in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// Proves the acceptances that need a database: the payload carries no answer
// text (only identity and aggregates are fetched, never answers.value), a
// respondent who starts then submits transitions not_started → in_progress →
// submitted, and F06-T05 unlock events surface with actor and timestamp.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "bbbb1111-bbbb-1111-bbbb-111111111301";
const OTHER_COHORT = "bbbb1111-bbbb-1111-bbbb-111111111302";
const FACILITATOR = "bbbb1111-bbbb-1111-bbbb-111111111303";
const NOT_STARTED = "bbbb1111-bbbb-1111-bbbb-111111111304";
const IN_PROGRESS = "bbbb1111-bbbb-1111-bbbb-111111111305";
const SUBMITTED = "bbbb1111-bbbb-1111-bbbb-111111111306";
const UNLOCKED = "bbbb1111-bbbb-1111-bbbb-111111111307";
const OUTSIDER = "bbbb1111-bbbb-1111-bbbb-111111111308";

// Answer text that must NEVER reach the roster payload (FR-29).
const STORED_ANSWER_TEXT = "the ground truth is stuck in one person's head";
const STORED_PRIVATE_NOTE = "this note only the facilitator may ever see";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

/** A respondent writes one of their own answers (their RLS context). */
async function seedAnswer(
  respondentId: string,
  questionId: string,
  value: object,
) {
  await withRespondentContext(db!, respondentId, (tx) =>
    upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: questionId,
      value,
    }),
  );
}

describe.skipIf(!enabled)("roster dashboard data against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `roster_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    const insertCohort = (id: string) =>
      db!.query(
        `insert into cohorts (id, name, quarter_label, status)
         values ($1, 'Test', 'Q4 2026', 'open')`,
        [id],
      );
    await insertCohort(COHORT);
    await insertCohort(OTHER_COHORT);

    const insertRespondent = (
      id: string,
      cohort: string,
      name: string,
      invite: string,
      code: string,
      fac = false,
    ) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, cohort, name, invite, code, fac],
      );

    await insertRespondent(FACILITATOR, COHORT, "Lia Mendoza", "token-roster-fac", "ROSF1", true);
    await insertRespondent(NOT_STARTED, COHORT, "Not Started", "token-roster-1", "ROSN1");
    await insertRespondent(IN_PROGRESS, COHORT, "In Progress", "token-roster-2", "ROSI1");
    await insertRespondent(SUBMITTED, COHORT, "Submitted", "token-roster-3", "ROSSU");
    await insertRespondent(UNLOCKED, COHORT, "Unlocked", "token-roster-4", "ROSU1");
    await insertRespondent(OUTSIDER, OTHER_COHORT, "Outsider", "token-roster-5", "ROSO1");

    // One public answer — the respondent has started.
    await seedAnswer(IN_PROGRESS, "q1", { text: STORED_ANSWER_TEXT });
    // A q14 with a private note: the note must never count or appear (q14d is
    // filtered from the count at the query, and no value is ever fetched).
    await seedAnswer(IN_PROGRESS, "q14", {
      wants: ["product"],
      others: {},
      hours: 20,
      private_note: STORED_PRIVATE_NOTE,
    });

    // A submitted respondent: answers then freezes them.
    await seedAnswer(SUBMITTED, "q1", { text: STORED_ANSWER_TEXT });
    await performSubmit(db!, SUBMITTED, COHORT);

    // An unlocked respondent: submitted, then reopened by the facilitator.
    await seedAnswer(UNLOCKED, "q1", { text: STORED_ANSWER_TEXT });
    await performSubmit(db!, UNLOCKED, COHORT);
    await performUnlock(db!, FACILITATOR, COHORT, UNLOCKED);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("returns every respondent in the cohort and none from another cohort", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const ids = roster.map((r) => r.respondentId);
    expect(ids).toContain(FACILITATOR);
    expect(ids).toContain(NOT_STARTED);
    expect(ids).toContain(IN_PROGRESS);
    expect(ids).toContain(SUBMITTED);
    expect(ids).toContain(UNLOCKED);
    expect(ids).not.toContain(OUTSIDER);
  });

  it("carries no answer text in the response payload", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const serialized = JSON.stringify(roster);
    // The stored answer and the private note must not appear anywhere in the
    // roster payload, not merely be hidden from the rendered view (F09-T03).
    expect(serialized).not.toContain(STORED_ANSWER_TEXT);
    expect(serialized).not.toContain(STORED_PRIVATE_NOTE);
  });

  it("reports status for a respondent who starts and then submits", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const byId = new Map(roster.map((r) => [r.respondentId, r]));

    expect(byId.get(NOT_STARTED)!.status).toBe("not_started");
    expect(byId.get(IN_PROGRESS)!.status).toBe("in_progress");
    expect(byId.get(SUBMITTED)!.status).toBe("submitted");
    // Unlocking reopens a submitted respondent's answers → back to in progress.
    expect(byId.get(UNLOCKED)!.status).toBe("in_progress");
  });

  it("counts progress over public questions, excluding the private row", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const inProgress = roster.find((r) => r.respondentId === IN_PROGRESS)!;
    // q1 and the public q14 row — the private q14d note is excluded from the count.
    expect(inProgress.progress).toBe(2);
    expect(inProgress.total).toBe(ROSTER_TOTAL_QUESTIONS);

    const notStarted = roster.find((r) => r.respondentId === NOT_STARTED)!;
    expect(notStarted.progress).toBe(0);
  });

  it("surfaces the F06-T05 unlock event with actor and timestamp", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const unlocked = roster.find((r) => r.respondentId === UNLOCKED)!;
    expect(unlocked.unlock).not.toBeNull();
    expect(unlocked.unlock!.byName).toBe("Lia Mendoza");
    expect(unlocked.unlock!.at).toBeInstanceOf(Date);

    const neverUnlocked = roster.find((r) => r.respondentId === SUBMITTED)!;
    expect(neverUnlocked.unlock).toBeNull();
  });

  it("gives last active and time spent only once the respondent has engaged", async () => {
    const roster = await fetchRoster(db!, FACILITATOR, COHORT);
    const byId = new Map(roster.map((r) => [r.respondentId, r]));

    // No answers, no submission → nothing to report.
    expect(byId.get(NOT_STARTED)!.lastActiveAt).toBeNull();
    expect(byId.get(NOT_STARTED)!.timeSpentSeconds).toBeNull();

    // In progress → last answer edit is the activity, time spent to now.
    expect(byId.get(IN_PROGRESS)!.lastActiveAt).toBeInstanceOf(Date);
    expect(byId.get(IN_PROGRESS)!.timeSpentSeconds).toBeGreaterThanOrEqual(0);

    // Submitted → last activity is at least the submission time.
    expect(byId.get(SUBMITTED)!.lastActiveAt).toBeInstanceOf(Date);
    expect(byId.get(SUBMITTED)!.timeSpentSeconds).toBeGreaterThanOrEqual(0);
  });
});