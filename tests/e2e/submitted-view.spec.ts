import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F06-T06 end to end: the submitted read-only view against a real Postgres, on
// the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's three acceptance criteria:
//
//   1. No editable control is reachable after submit, including by direct URL
//      — the read-only view at "/" renders no inputs/edit links/submit, and
//      direct hits on /review and /q/:id redirect a submitted respondent away.
//   2. The read-only view stays reachable after the cohort closes — readOnly
//      admits rather than refuses, so "/" still renders the finished view.
//   3. The copy reads as completion, not as lockout — "You're all set", with
//      the answers listed underneath as the expected outcome of having
//      finished.
//
// The OPSP (F07) and PDF (F08) routes are not built yet; this ticket's part of
// "keep the OPSP and PDF reachable after the cohort closes" is that the view
// they will hang off remains served to a submitted respondent even once the
// cohort status is closed.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();
const TEAMMATE = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Submitted View', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A teammate so q14(b)'s "thinks others own" names resolve from the roster.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Maya', 'teammate', 'TEAM1', false)`,
    [TEAMMATE, COHORT],
  );
  // The submitted respondent. ground_rules_acknowledged_at is set, because the
  // home page holds the read-only view behind the ground-rules gate; submitted_at
  // is stamped after seeding.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Done Person', $3, 'DONEP1', false, now())`,
    [RESPONDENT, COHORT, `submitted-view-${run}`],
  );

  await withRespondentContext(db!, RESPONDENT, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: RESPONDENT,
      question_id: "q1",
      value: { text: "The ground truth is stuck in one person's head." },
    });
    await upsertAnswer(tx, {
      respondent_id: RESPONDENT,
      question_id: "q14",
      value: {
        wants: ["product"],
        others: { [TEAMMATE]: "backend" },
        hours: 12,
        private_note: "worried about the runway",
      },
    });
  });

  // Lock it: answers immutable (PR5), the finished view is the only way back in.
  await db.query("update respondents set submitted_at = now() where id = $1", [RESPONDENT]);
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

async function setSession(page: Page) {
  const token = createSessionToken({ respondentId: RESPONDENT, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

/** Everything that would count as an editable control on a respondent screen. */
const EDITABLE = "input, textarea, select, button";

test("a submitted respondent sees their answers read-only, framed as finished", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/");

  // Completion copy, not a lockout (ui_ux.md §6 "Already submitted").
  await expect(page.getByText("You're all set, Done Person.")).toBeVisible();
  await expect(page.getByText(/baseline is locked/)).toBeVisible();

  // The answers render read-only: question text and the stored summary.
  await expect(page.getByTestId("submitted-summary-q1")).toContainText(
    "The ground truth is stuck in one person's head.",
  );
  await expect(page.getByTestId("submitted-q1")).toContainText(
    "Why does Anakloud need to exist?",
  );

  // The respondent's own q14 private note is on their own finished view.
  await expect(page.getByTestId("private-note")).toContainText("worried about the runway");
  await expect(page.getByTestId("submitted-summary-q14")).toContainText("Maya: backend");

  // No editable controls of any kind, and no way back into the question flow.
  await expect(page.locator(EDITABLE)).toHaveCount(0);
  await expect(page.locator('a[href^="/q/"]')).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Continue" })).toHaveCount(0);
});

test("no editable control is reachable after submit, including by direct URL", async ({
  page,
}) => {
  await setSession(page);

  // Direct URL to the review screen (editable: edit links + submit) bounces out.
  await page.goto("/review");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("You're all set, Done Person.")).toBeVisible();
  await expect(page.locator(EDITABLE)).toHaveCount(0);

  // Direct URL to a question screen (an editable input) bounces out too.
  await page.goto("/q/1");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("You're all set, Done Person.")).toBeVisible();
  await expect(page.locator(EDITABLE)).toHaveCount(0);
});

test("the read-only view stays reachable after the cohort closes", async ({ page }) => {
  await setSession(page);

  // Close the cohort: readOnly must admit, never refuse, the submitted view.
  await db!.query("update cohorts set status = 'closed' where id = $1", [COHORT]);

  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText("You're all set, Done Person.")).toBeVisible();
  await expect(page.getByTestId("submitted-summary-q1")).toBeVisible();
  await expect(page.locator(EDITABLE)).toHaveCount(0);

  // Leave the cohort open again for any later cleanup/assertions.
  await db!.query("update cohorts set status = 'open' where id = $1", [COHORT]);
});