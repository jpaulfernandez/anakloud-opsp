import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { withRespondentContext } from "../../lib/access";
import { migrate } from "../../lib/migrate";
import { upsertAnswer } from "../../lib/answers";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F04-T05 end to end: the resume landing at "/". Against a real Postgres (same
// opt-in as the other DB-gated e2e specs — SKIP unless DATABASE_URL and
// SESSION_SECRET are present), because "which question is first unanswered"
// reads the respondent's persisted answer rows. Covers the ticket's three
// acceptance criteria:
//
//   1. Resuming with Q1-Q6 answered lands on Q7.
//   2. Resuming with Q1-Q6 and Q9 answered lands on Q7, not Q10.
//   3. A submitted respondent never re-enters the questionnaire flow.
//
// A session cookie is set directly (as autosave.spec does) so each test
// arrives at "/" as an already-claimed responder and exercises the resume
// screen itself.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

const R = {
  partial: randomUUID(), // Q1-Q6 answered, unsubmitted
  sparse: randomUUID(), // Q1-Q6 and Q9 answered, unsubmitted
  submitted: randomUUID(), // submitted_at set
} as const;
const NAMES = { partial: "Partial Person", sparse: "Sparse Person", submitted: "Done Person" } as const;

let db: Client | null = null;

/** Minimal but shape-valid answer values for the questions we seed. */
const SEED: Record<string, { question_id: string; value: unknown }[]> = {
  partial: [
    { question_id: "q1", value: { text: "Why Anakloud exists." } },
    { question_id: "q2", value: { who: "Centers", because: "they'd go back to ledgers." } },
    { question_id: "q3", value: { metric: "paying centers", value: 100, unit: "paying_centers", why: "adoption." } },
    { question_id: "q4", value: { text: "Ten years out." } },
    { question_id: "q5", value: { pays: [], decides: [], uses: [], benefits: [] } },
    { question_id: "q6", value: { choice: "center", why: "they pay." } },
  ],
  sparse: [
    { question_id: "q1", value: { text: "Why Anakloud exists." } },
    { question_id: "q2", value: { who: "Centers", because: "they'd go back to ledgers." } },
    { question_id: "q3", value: { metric: "paying centers", value: 100, unit: "paying_centers", why: "adoption." } },
    { question_id: "q4", value: { text: "Ten years out." } },
    { question_id: "q5", value: { pays: [], decides: [], uses: [], benefits: [] } },
    { question_id: "q6", value: { choice: "center", why: "they pay." } },
    { question_id: "q9", value: { items: ["no teletherapy", "no adult rehab", "no hospitals"] } },
  ],
  submitted: [
    { question_id: "q1", value: { text: "Already answered and locked." } },
  ],
};

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Resume Landing', 'Q4 2026', 'open')",
    [COHORT],
  );
  for (const tag of Object.keys(R) as (keyof typeof R)[]) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, $3, $4, 'RESUME', false, now())`,
      [R[tag], COHORT, NAMES[tag], `resume-landing-${tag}-${run}`],
    );
  }

  for (const tag of Object.keys(R) as (keyof typeof R)[]) {
    await withRespondentContext(db!, R[tag], async (tx) => {
      for (const a of SEED[tag]) {
        await upsertAnswer(tx, {
          respondent_id: R[tag],
          question_id: a.question_id,
          value: a.value,
        });
      }
    });
  }

  // The submitted respondent is locked: `submitted_at` set, answers immutable.
  await db.query("update respondents set submitted_at = now() where id = $1", [R.submitted]);
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
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

test("resuming with Q1-Q6 answered greets the respondent and lands on Q7", async ({
  page,
}) => {
  await setSession(page, R.partial);
  await page.goto("/");

  await expect(
    page.getByText(`Welcome back, ${NAMES.partial}.`),
  ).toBeVisible();
  await expect(page.getByText("You're on question 7 of 15.")).toBeVisible();

  // The resume screen lists answered questions so any of them can be jumped to.
  await expect(
    page.getByRole("listitem").filter({ hasText: "Why does Anakloud need to exist?" }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/7$/);
});

test("resuming with Q1-Q6 and Q9 answered lands on Q7, not Q10", async ({
  page,
}) => {
  await setSession(page, R.sparse);
  await page.goto("/");

  // The gap: Q7 and Q8 are unanswered while Q9 is answered. First unanswered
  // is still Q7 — the resume screen must not skip to the next answered one.
  await expect(page.getByText("You're on question 7 of 15.")).toBeVisible();

  await page.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/7$/);
  await expect(page).not.toHaveURL(/\/q\/10$/);
});

test("a submitted respondent never re-enters the questionnaire flow", async ({
  page,
}) => {
  await setSession(page, R.submitted);
  await page.goto("/");

  // No Continue, no jump-back-to-a-question links: the flow is closed.
  await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);
  await expect(page.locator('a[href^="/q/"]')).toHaveCount(0);

  // The landing reads as done, not as a lockout (ui_ux.md §6 "Already submitted").
  await expect(page.getByText(`You're all set, ${NAMES.submitted}.`)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});