import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T04 end to end: the metric-triple input on Q3 against a real Postgres
// (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: the four
// labelled fields (metric name, number, unit, one-line why), the number field
// accepting "1,500" with thousands separators, unit rendered as free text with
// no unit suggestions anywhere (no datalist, no select, no list attribute,
// autofill switched off), the number+unit grouped visually as one statement,
// and Continue staying blocked until all four parts hold content.

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

  // One acknowledged, unsubmitted respondent (past the ground-rules gate) so
  // the Q3 URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Metric Triple', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Metric Person', $3, 'MTR1', false, now())`,
    [RESPONDENT, COHORT, `metric-triple-e2e-${run}`],
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

test("Q3 renders the four labelled fields with the number and unit grouped as one statement", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/3");

  // The four fields, each reachable by its label (ui_ux §4.6: "What would you
  // count?", "How many?", "Why that one?").
  await expect(page.getByLabel("What would you count?")).toBeVisible();
  await expect(page.getByLabel("Number")).toBeVisible();
  await expect(page.getByLabel("Unit")).toBeVisible();
  await expect(page.getByLabel("Why that one?")).toBeVisible();

  // The "How many?" fieldset groups the number and unit together so they read
  // as one statement rather than three unrelated inputs.
  const group = page.getByTestId("q3-number-unit");
  await expect(group).toBeVisible();
  await expect(group.getByLabel("Number")).toBeVisible();
  await expect(group.getByLabel("Unit")).toBeVisible();
});

test("no unit suggestions appear anywhere, and unit is free text", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/3");

  // The unit field is a plain text input (free text, not a select or combobox).
  const unit = page.getByLabel("Unit");
  await expect(unit).toHaveAttribute("type", "text");
  await expect(unit).not.toHaveAttribute("type", "select");

  // No candidate-unit enumerating control is present anywhere on the screen —
  // no datalist (the mechanism that would seed autocomplete suggestions), and
  // the unit input does not point at one via a `list` attribute.
  await expect(page.locator("datalist")).toHaveCount(0);
  expect(await unit.evaluate((el) => el.hasAttribute("list"))).toBe(false);

  // No candidate-unit combobox either — the only roles are the expected inputs.
  await expect(page.getByRole("combobox")).toHaveCount(0);

  // Autofill hints are switched off, so the browser cannot seed its own unit
  // suggestions on top of the free-text field.
  await expect(unit).toHaveAttribute("autocomplete", "off");

  // The unit field accepts and keeps arbitrary free text.
  await unit.fill("children");
  await expect(unit).toHaveValue("children");
});

test("1,500 with thousands separators counts as a value and unblocks Continue", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/3");

  // Q3 is required: an empty metric triple blocks Continue with the reason.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/3$/);

  // Filling only the number (with separators) is not an answer on its own.
  await page.getByLabel("Number").fill("1,500");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/3$/);

  // Complete the three text parts; the "1,500" is accepted as a value and the
  // answer unblocks Continue (the normalisation to 1500 is unit-tested).
  await page.getByLabel("What would you count?").fill(
    "Children with an active therapy plan",
  );
  await page.getByLabel("Unit").fill("children");
  await page.getByLabel("Why that one?").fill(
    "that's the number that means we changed something",
  );

  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/4$/);
});