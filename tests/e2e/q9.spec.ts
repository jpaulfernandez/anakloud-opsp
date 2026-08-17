import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T10 end to end: the three-short-fields input on Q9 against a real
// Postgres (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: Q9
// renders as three separate labelled fields, all three required before
// Continue, and none of them carries placeholder text.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Q9 Not Doing', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Q9 Person', $3, 'QNOT', false, now())`,
    [RESPONDENT, COHORT, `q9-e2e-${run}`],
  );
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
  const sessionToken = createSessionToken({
    respondentId: RESPONDENT,
    cohortId: COHORT,
  });
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

test("Q9 renders three separate labelled fields with no placeholder text", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/9");

  // Three distinct, reachable-by-label fields — never two anonymous boxes.
  const first = page.getByLabel("Not doing 1");
  const second = page.getByLabel("Not doing 2");
  const third = page.getByLabel("Not doing 3");
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(third).toBeVisible();

  // Placeholder text is forbidden on all of them.
  for (const field of [first, second, third]) {
    expect(await field.evaluate((el) => el.getAttribute("placeholder"))).toBeNull();
  }
});

test("all three Q9 fields are required before Continue unblocks", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/9");

  const continueButton = page.getByRole("button", { name: "Continue" });

  // Filling only one or two of the three is not an answer.
  await page.getByLabel("Not doing 1").fill("Not delivering teletherapy ourselves.");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/9$/);

  await page.getByLabel("Not doing 2").fill("Not adult therapy clinics.");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();

  // Complete the third; the answer advances.
  await page.getByLabel("Not doing 3").fill(
    "No expansion outside the Philippines before 200 centers.",
  );
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/10$/);
});