import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { createSessionToken } from "../../lib/session";
import { migrate } from "../../lib/migrate";

// F06-T05 facilitator unlock through the live HTTP route. Same opt-in as the
// other DB-gated e2e specs (SKIP unless DATABASE_URL and SESSION_SECRET are
// present). Covers the ticket's HTTP acceptances: a facilitator can unlock a
// submitted respondent and the audit names them, a non-facilitator cannot reach
// the route at all, a target outside the facilitator's cohort is refused, and a
// malformed body is rejected. The snapshot-preservation and re-submit behaviour
// live in the integration test (unlock.integration.test.ts); this file is the
// gate itself — who is allowed in through the wire.

const enabled =
  process.env.DATABASE_URL !== undefined &&
  process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const OTHER_COHORT = randomUUID();
const FACILITATOR = randomUUID();
const NON_FACILITATOR = randomUUID();
const SUBMITTED = randomUUID();
const OUTSIDER = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  const insertCohort = (id: string) =>
    db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Unlock', 'Q4 2026', 'open')",
      [id],
    );
  await insertCohort(COHORT);
  await insertCohort(OTHER_COHORT);

  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Facilitator', $3, 'UNLFA1', true)`,
    [FACILITATOR, COHORT, `unlock-fac-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Non Facilitator', $3, 'UNLNF1', false)`,
    [NON_FACILITATOR, COHORT, `unlock-nf-${run}`],
  );
  // Submitted respondent; the posted answer is irrelevant to the route, which
  // only clears the lock, but submitted_at must be set for the unlock to act.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Submitted Person', $3, 'UNLSB1', false, now())`,
    [SUBMITTED, COHORT, `unlock-sub-${run}`],
  );
  // A respondent in a *different* cohort, so a cross-cohort unlock is refused.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Outsider', $3, 'UNLOU1', false, now())`,
    [OUTSIDER, OTHER_COHORT, `unlock-out-${run}`],
  );
});

test.afterAll(async () => {
  if (db) {
    await db
      .query("delete from respondents where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [OTHER_COHORT]).catch(() => {});
    await db.end();
  }
});

async function unlockAs(
  request: APIRequestContext,
  actorId: string,
  actorCohort: string,
  targetId: string,
) {
  const token = createSessionToken({ respondentId: actorId, cohortId: actorCohort });
  return request.post("/api/admin/unlock", {
    headers: { cookie: `align_session=${token}` },
    data: { respondentId: targetId },
  });
}

/** The lock + audit state of one respondent, read directly (respondents is not RLS-gated). */
async function lockState(respondentId: string) {
  const { rows } = await db!.query(
    `select submitted_at, unlocked_by from respondents where id = $1`,
    [respondentId],
  );
  return { submittedAt: rows[0]?.submitted_at ?? null, unlockedBy: rows[0]?.unlocked_by ?? null };
}

test("a facilitator can unlock a submitted respondent and the audit names them", async ({
  request,
}) => {
  const res = await unlockAs(request, FACILITATOR, COHORT, SUBMITTED);
  expect(res.status()).toBe(200);
  await expect(res.json()).resolves.toMatchObject({ ok: true, unlocked: true });

  const state = await lockState(SUBMITTED);
  expect(state.submittedAt).toBeNull();
  expect(state.unlockedBy).toBe(FACILITATOR);
});

test("a non-facilitator cannot reach the unlock route", async ({ request }) => {
  const before = await lockState(SUBMITTED);

  const res = await unlockAs(request, NON_FACILITATOR, COHORT, SUBMITTED);
  expect(res.status()).toBe(403);

  // Nothing changed — the non-facilitator was refused at the gate, before any write.
  const after = await lockState(SUBMITTED);
  expect(after.submittedAt).toBe(before.submittedAt);
  expect(after.unlockedBy).toBe(before.unlockedBy);
});

test("a target outside the facilitator's cohort is refused with 404", async ({ request }) => {
  const res = await unlockAs(request, FACILITATOR, COHORT, OUTSIDER);
  expect(res.status()).toBe(404);
  await expect(res.json()).resolves.toMatchObject({ ok: false });
});

test("a malformed body is refused with 400", async ({ request }) => {
  const token = createSessionToken({
    respondentId: FACILITATOR,
    cohortId: COHORT,
  });
  const res = await request.post("/api/admin/unlock", {
    headers: { cookie: `align_session=${token}` },
    data: { nope: 1 },
  });
  expect(res.status()).toBe(400);
});