import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F09-T02 end to end: the admin-locked UI state against a real Postgres, on
// the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's three acceptance criteria:
//
//   1. No answer content is present in the DOM of the locked state — the
//      unsubmitted facilitator has stored answers in the database, and /admin
//      must render none of them.
//   2. The copy reads as a rule, with no error styling — "Finish your own
//      answers first." as plain neutral copy, with no alert semantics.
//   3. The link resumes the facilitator's own session correctly — following it
//      lands on the resume landing, not back on /admin, with Continue into the
//      questionnaire.
//
// The pure view decision (non-facilitator → away, unsubmitted facilitator →
// locked, submitted facilitator → dashboard) is asserted in
// tests/unit/admin-locked.test.ts; this file is the rendered DOM itself.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
// An unsubmitted facilitator: FR-28 holds them here until they submit.
const UNSUB_FAC = randomUUID();
// A submitted facilitator: the dashboard admits them, never the locked rule.
const SUB_FAC = randomUUID();
// A plain respondent: the admin area is not theirs, /admin sends them away.
const RESPONDENT = randomUUID();

/** A stored answer that MUST NOT leak into any admin screen (FR-29). */
const STORED_ANSWER = "the ground truth is stuck in one person's head";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Admin Locked', 'Q4 2026', 'open')",
    [COHORT],
  );
  // FAQ: the unsubmitted facilitator has ground rules acknowledged and a stored
  // answer, so both the "no answer content on /admin" and "link resumes the
  // session" assertions are against a real, in-progress session.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Facilitator Locked', $3, 'ADLKL1', true, now())`,
    [UNSUB_FAC, COHORT, `admin-locked-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Facilitator Open', $3, 'ADLKO1', true, now())`,
    [SUB_FAC, COHORT, `admin-open-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Respondent Norm', $3, 'ADLKN1', false, now())`,
    [RESPONDENT, COHORT, `admin-respondent-${run}`],
  );

  // Put real answer content in the database that must not appear on /admin.
  await withRespondentContext(db!, UNSUB_FAC, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: UNSUB_FAC,
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

test("an unsubmitted facilitator sees the locked rule and none of their answer content", async ({
  page,
}) => {
  await setSession(page, UNSUB_FAC);
  await page.goto("/admin");

  // The rule copy, verbatim (ui_ux.md §6 "Admin locked"), as a link-bearing rule.
  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-locked")).toContainText(
    "Finish your own answers first.",
  );

  // No answer content whatsoever: the stored answer is absent, and the q1
  // question that answer belongs to is absent too.
  await expect(page.getByText(STORED_ANSWER, { exact: false })).toHaveCount(0);
  await expect(page.getByText("Why does Anakloud need to exist?")).toHaveCount(0);
});

test("the locked copy reads as a rule, with no error styling", async ({ page }) => {
  await setSession(page, UNSUB_FAC);
  await page.goto("/admin");

  // A rule is presented as neutral guidance (ui_ux.md §6 "Admin locked"), never
  // as an error someone must dismiss: the locked element is not announced as an
  // alert or status region, and it is styled in the app's neutral ink palette
  // rather than in a failure colour.
  const locked = page.getByTestId("admin-locked");
  await expect(locked).toBeVisible();
  await expect(locked).not.toHaveAttribute("role", "alert");
  await expect(locked).not.toHaveAttribute("role", "status");
  await expect(locked).toHaveClass(/text-neutral-/);
});

test("the link resumes the facilitator's own session correctly", async ({ page }) => {
  await setSession(page, UNSUB_FAC);
  await page.goto("/admin");

  const resumeLink = page.getByRole("link", { name: "Resume your questionnaire" });
  await expect(resumeLink).toHaveAttribute("href", "/");
  await resumeLink.click();

  // The resume landing, not back on /admin: the facilitator picks up their own,
  // unfinished questionnaire from here (F04-T05).
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Welcome back, Facilitator Locked.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();
});

test("a submitted facilitator is admitted and never sees the locked rule", async ({ page }) => {
  await setSession(page, SUB_FAC);
  await page.goto("/admin");

  await expect(page.getByText("Admin", { exact: true })).toBeVisible();
  await expect(page.getByTestId("admin-locked")).toHaveCount(0);
  await expect(page.getByText("Finish your own answers first.")).toHaveCount(0);
});

test("a non-facilitator is sent back to their own questionnaire, not the locked rule", async ({
  page,
}) => {
  await setSession(page, RESPONDENT);
  await page.goto("/admin");

  // /admin redirects a respondent away; they land on their own question flow,
  // not on the facilitator's locked state, and see no admin copy.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("Welcome back, Respondent Norm.")).toBeVisible();
  await expect(page.getByText("Finish your own answers first.")).toHaveCount(0);
});