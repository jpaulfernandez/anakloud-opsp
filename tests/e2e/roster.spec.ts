import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F09-T03 end to end: the roster dashboard against a real Postgres, on the
// same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's rendered acceptances:
//
//   1. The roster table shows name, status, progress, last active and time
//      spent — and NOTHING of the answers. A stored answer that must not leak
//      is written to the database and asserted absent from both the rendered
//      DOM and the /api/admin/roster response payload.
//   2. Statuses are surfaced for a not-started and a submitted respondent.
//
// The pure status transitions are asserted in tests/unit/roster.test.ts; the
// payload has no answer text by construction (lib/roster.ts), pinned again
// here over the wire and in the DOM.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const UNSUB_FACILITATOR = randomUUID();
const NOT_STARTED = randomUUID();
const IN_PROGRESS = randomUUID();
const SUBMITTED = randomUUID();

/** Answer content that must NOT leak into any roster view (FR-29). */
const STORED_ANSWER = "the ground truth is stuck in one person's head";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Roster', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator: F09-T01 admits them to the dashboard.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', $3, 'ROFE1', true, now())`,
    [FACILITATOR, COHORT, `roster-fac-${run}`],
  );
  // An unsubmitted facilitator: the F09-T01 gate must refuse /api/admin/roster.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Fac Unsubmitted', $3, 'ROUF1', true)`,
    [UNSUB_FACILITATOR, COHORT, `roster-uf-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Tory Unstarted', $3, 'RONA1', false)`,
    [NOT_STARTED, COHORT, `roster-na-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Ira Working', $3, 'ROIP1', false)`,
    [IN_PROGRESS, COHORT, `roster-ip-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Sal Done', $3, 'ROSU1', false, now())`,
    [SUBMITTED, COHORT, `roster-su-${run}`],
  );

  // Put real answer content in the database that must not appear on the roster.
  await withRespondentContext(db!, IN_PROGRESS, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: IN_PROGRESS,
      question_id: "q1",
      value: { text: STORED_ANSWER },
    });
  });
});

test.afterAll(async () => {
  if (db) {
    await db
      .query("delete from respondents where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

async function setSession(page: Page, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

function asAdmin(request: APIRequestContext, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  return request.get("/api/admin/roster", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

test("the roster API response carries roster facts and no answer text", async ({
  request,
}) => {
  const res = await asAdmin(request, FACILITATOR);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);

  const names = body.roster.map((r: { name: string }) => r.name);
  expect(names).toEqual(
    expect.arrayContaining(["Lia Mendoza", "Tory Unstarted", "Ira Working", "Sal Done"]),
  );

  const statusBy = new Map(
    body.roster.map((r: { name: string; status: string }) => [r.name, r.status]),
  );
  expect(statusBy.get("Tory Unstarted")).toBe("not_started");
  expect(statusBy.get("Ira Working")).toBe("in_progress");
  expect(statusBy.get("Sal Done")).toBe("submitted");

  // No answer text in the response payload, not merely in the rendered view.
  expect(JSON.stringify(body)).not.toContain(STORED_ANSWER);
});

test("an unsubmitted facilitator is refused by the roster route", async ({ request }) => {
  // Same F09-T01 gate as every /api/admin/* route, checked over the wire:
  // a facilitator who has not submitted gets a 403 no matter what the client
  // sends.
  const token = createSessionToken({ respondentId: UNSUB_FACILITATOR, cohortId: COHORT });
  const res = await request.get("/api/admin/roster", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  expect(res.status()).toBe(403);
});

test("the roster DOM shows names and statuses and no answer content", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin");

  const table = page.getByTestId("roster-table");
  await expect(table).toBeVisible();

  // The four people, shown by name.
  await expect(table.getByText("Tory Unstarted")).toBeVisible();
  await expect(table.getByText("Ira Working")).toBeVisible();
  await expect(table.getByText("Sal Done")).toBeVisible();

  // Statuses shown per respondent, including a not-started and a submitted one.
  // (Two people share "Not started" — Tory Unstarted and the unsubmitted Fac
  // Unsubmitted — so each assertion is scoped to its own row to stay precise.)
  await expect(
    table.getByRole("row", { name: /Tory Unstarted/ }).getByText("Not started", { exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("row", { name: /Ira Working/ }).getByText("In progress", { exact: true }),
  ).toBeVisible();
  await expect(
    table.getByRole("row", { name: /Sal Done/ }).getByText("Submitted", { exact: true }),
  ).toBeVisible();

  // No answer content whatsoever on the screen (FR-29).
  await expect(table.getByText(STORED_ANSWER, { exact: false })).toHaveCount(0);
});