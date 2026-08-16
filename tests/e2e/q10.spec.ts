import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T10 end to end: the four-part money input on Q10 against a real Postgres
// (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: the four
// parts (payer, model, peso amount, month-year picker), the amount's unit
// label following the chosen model, the YYYY-MM month picker, and — the point
// of the question — "not sure yet" on the model being accepted as complete and
// valid rather than penalised.

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
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Q10 Money', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Q10 Person', $3, 'MNY1', false, now())`,
    [RESPONDENT, COHORT, `q10-e2e-${run}`],
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

test("Q10 renders all four parts with no placeholder text", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/10");

  await expect(page.getByTestId("q10-payer")).toBeVisible();
  await expect(page.getByTestId("q10-model")).toBeVisible();
  await expect(page.getByLabel("What do they pay, in pesos?")).toBeAttached();
  await expect(page.getByTestId("q10-month-picker")).toBeVisible();

  // Placeholder text is forbidden on the free-entry fields.
  expect(
    await page
      .getByLabel("What do they pay, in pesos?")
      .evaluate((el) => el.getAttribute("placeholder")),
  ).toBeNull();
  expect(
    await page
      .getByTestId("q10-month-picker")
      .evaluate((el) => el.getAttribute("placeholder")),
  ).toBeNull();

  // All seven payer and eight model options are present.
  for (const option of ["center", "parent", "pediatrician/clinic", "school",
    "LGU/DOH", "HMO", "other"]) {
    await expect(page.getByLabel(option, { exact: true })).toBeAttached();
  }
  for (const option of ["monthly subscription per center", "per-seat/per-therapist",
    "per active child per month", "per session fee", "freemium with parent upgrade",
    "commission on referrals", "grant or institutional funding", "not sure yet"]) {
    await expect(page.getByLabel(option, { exact: true })).toBeAttached();
  }
});

test("Q10(c)'s unit label follows the model chosen in (b)", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/10");

  // No model chosen yet: no unit suffix on the amount.
  await expect(page.getByText("pesos · per", { exact: false })).toHaveCount(0);

  await page.getByLabel("per session fee", { exact: true }).check();
  await expect(page.getByText("pesos · per session")).toBeVisible();

  await page.getByLabel("monthly subscription per center", { exact: true }).check();
  await expect(page.getByText("pesos · per center per month")).toBeVisible();
});

test("selecting 'not sure yet' on Q10(b) is a complete, valid answer", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/10");

  const continueButton = page.getByRole("button", { name: "Continue" });

  // Not answered at the start.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();

  // Payer "parent" + model "not sure yet": no amount and no month demanded —
  // the acceptance that "not sure yet … passes validation and produces no
  // nudge". The one thing Q10 still requires is the confidence ring (F03-T11,
  // FR-11), so the shell refuses with its own line before advancing.
  await page.getByLabel("parent", { exact: true }).check();
  await page.getByLabel("not sure yet", { exact: true }).check();
  await continueButton.click();
  await expect(page.getByText("Let us know how confident you are, from 1 to 5, before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/10$/);

  await page.getByLabel("Confidence (number)").fill("3");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/11$/);
});

test("a concrete model requires an amount and a YYYY-MM month", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/10");

  const continueButton = page.getByRole("button", { name: "Continue" });

  await page.getByLabel("center", { exact: true }).check();
  await page.getByLabel("per session fee", { exact: true }).check();

  // A real model commits the respondent to a number and a first-peso month.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();

  await page.getByLabel("What do they pay, in pesos?").fill("500");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();

  // The month picker produces YYYY-MM and unblocks the generic block.
  const month = page.getByTestId("q10-month-picker");
  await month.fill("2026-11");
  await expect(month).toHaveValue("2026-11");

  // Q10 still requires its confidence ring (F03-T11, FR-11) before advancing.
  await continueButton.click();
  await expect(page.getByText("Let us know how confident you are, from 1 to 5, before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/10$/);

  await page.getByLabel("Confidence (number)").fill("4");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/11$/);
});