import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T08 end to end: the paired-rows + star input (Q11) against a real
// Postgres (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: three
// blocks each with a "What" and a "Done when" field, a star that is a radio
// across all three blocks (not a checkbox) so selecting a second star clears
// the first and surfaces the inline note "Only one can be the most important —
// that's the point.", and a required check that passes with only block one
// filled — blocks two and three are optional.
//
// The note is microcopy, not a validation error: it renders as a plain
// statement, never through a role="alert" or as an aria-invalid field message.

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
  // the Q11 URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Paired Rows', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Paired Rows Person', $3, 'PRR1', false, now())`,
    [RESPONDENT, COHORT, `paired-rows-e2e-${run}`],
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

test("renders three blocks, each with a What and a Done when field", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/11");

  const group = page.getByTestId("paired-rows");
  await expect(group).toBeVisible();

  // Three repeating blocks, each carrying a "What" and a "Done when" field.
  for (const n of [1, 2, 3]) {
    await expect(
      group.getByRole("group", { name: `Priority ${n}` }),
    ).toBeVisible();
  }
  await expect(group.getByRole("textbox", { name: "What" })).toHaveCount(3);
  await expect(group.getByRole("textbox", { name: "Done when" })).toHaveCount(3);

  // The star is a radio across all three blocks, never a checkbox.
  await expect(group.getByRole("radio")).toHaveCount(3);
  await expect(
    group.getByRole("radio", { name: /most important one/ }),
  ).toHaveCount(3);
  await expect(group.locator('input[type="checkbox"]')).toHaveCount(0);

  // No note before any star is replaced.
  await expect(page.getByText(/Only one can be the most important/)).toHaveCount(
    0,
  );
});

test("selecting a second star clears the first and surfaces the note", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/11");

  const group = page.getByTestId("paired-rows");
  const stars = group.getByRole("radio");

  // A first star selection alone shows no note.
  await stars.nth(0).check();
  await expect(stars.nth(0)).toBeChecked();
  await expect(page.getByText(/Only one can be the most important/)).toHaveCount(
    0,
  );

  // Selecting a second star clears the first (radio, not checkbox).
  await stars.nth(1).check();
  await expect(stars.nth(1)).toBeChecked();
  await expect(stars.nth(0)).not.toBeChecked();
  await expect(stars.nth(2)).not.toBeChecked();

  // And surfaces the inline note carrying the §4.10 reason.
  await expect(
    page.getByText(/Only one can be the most important — that's the point\./),
  ).toBeVisible();

  // The note is microcopy, never a validation error: the Q11 input renders no
  // alert region (only the framework's global route announcer carries
  // role=alert), and the note is a plain `<p>`, not an aria-invalid field
  // message.
  await expect(group.getByRole("alert")).toHaveCount(0);
  await expect(
    group.getByRole("radio", { name: /most important one/ }),
  ).toHaveCount(3);

  // The cleared star can be re-picked, which simply replaces the new one.
  await stars.nth(2).check();
  await expect(stars.nth(2)).toBeChecked();
  await expect(stars.nth(1)).not.toBeChecked();
});

test("completing only block one passes the required check", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/11");

  const group = page.getByTestId("paired-rows");
  const continueButton = page.getByRole("button", { name: "Continue" });

  // Blocks two and three are optional: a single well-formed first rock is a
  // full Q11 answer, so Continue reads it as answered. But Q11 also carries a
  // required confidence ring (F03-T11, FR-11): an answered rock with no ring
  // is still refused, with its own explanatory line.
  await group
    .getByRole("textbox", { name: "What" })
    .nth(0)
    .fill("Onboard beta centers");
  await group
    .getByRole("textbox", { name: "Done when" })
    .nth(0)
    .fill("8 centers have each logged 20+ real sessions");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByText("Let us know how confident you are, from 1 to 5, before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/11$/);

  // Setting the ring lets Continue advance past /q/12.
  await page.getByLabel("Confidence (number)").fill("2");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/12$/);
});

test("Continue stays blocked until block one has a done-condition", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/11");

  const continueButton = page.getByRole("button", { name: "Continue" });

  // Empty question blocks Continue with the shell's generic line.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/11$/);

  // A bare "What" with no "Done when" is not a rock ("improve onboarding" is
  // not done-able, baseline Q11), so it still blocks.
  await page
    .getByTestId("paired-rows")
    .getByRole("textbox", { name: "What" })
    .nth(0)
    .fill("Improve onboarding");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/11$/);
});