import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T10 end to end: the capped short-text input on Q4 (140), Q7 (120) and
// Q12 (40) against a real Postgres (same opt-in as the other DB-gated
// integration specs — SKIP unless DATABASE_URL and SESSION_SECRET are present).
// It covers the ticket: each field is a single line with a hard, *input-time*
// character cap and a visible live counter, and no field carries placeholder
// text.

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
  // the Q4 / Q7 / Q12 URLs are reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Short Text', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Short Text Person', $3, 'SHRT', false, now())`,
    [RESPONDENT, COHORT, `short-text-e2e-${run}`],
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

test("Q4 enforces its 140-character cap at input, with a live counter", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/4");

  const input = page.getByTestId("capped-short-text-input");
  await expect(input).toBeVisible();

  // The counter counts up to the cap and starts at 0.
  await expect(page.getByText("0 of 140")).toBeVisible();

  // Placeholder text is forbidden (a placeholder anchors); the field must not
  // carry one.
  expect(await input.evaluate((el) => el.getAttribute("placeholder"))).toBeNull();

  // Paste well past the cap: the value clamps to 140 characters and the
  // counter reads 140 of 140 — the cap is enforced at input, not at a later
  // validation pass (F03-T10 acceptance).
  const over = "x".repeat(180);
  await input.fill(over);
  await expect(input).toHaveValue("x".repeat(140));
  await expect(page.getByText("140 of 140")).toBeVisible();
  await expect(page.getByText("180 of 180")).not.toBeVisible();
});

test("a capped short-text answer unblocks Continue", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/4");

  // Q4 is required: an empty field blocks Continue with the reason.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/4$/);

  // A single non-blank line is an answer, but Q4 also carries a required
  // confidence ring (F03-T11, FR-11): an answered line with no ring is still
  // refused with its own line.
  await page.getByTestId("capped-short-text-input").fill(
    "Every child with a developmental delay is identified before age five.",
  );
  await continueButton.click();
  await expect(page.getByText("Let us know how confident you are, from 1 to 5, before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/4$/);

  // Setting the ring lets Continue advance.
  await page.getByLabel("Confidence (number)").fill("5");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/5$/);
});

test("Q7 and Q12 carry their own caps (120 and 40)", async ({ page }) => {
  await setSession(page);

  await page.goto("/q/7");
  await expect(page.getByText("0 of 120")).toBeVisible();
  await page.getByTestId("capped-short-text-input").fill("y".repeat(130));
  await expect(page.getByTestId("capped-short-text-input")).toHaveValue(
    "y".repeat(120),
  );

  await page.goto("/q/12");
  await expect(page.getByText("0 of 40")).toBeVisible();
  await page.getByTestId("capped-short-text-input").fill("z".repeat(50));
  await expect(page.getByTestId("capped-short-text-input")).toHaveValue(
    "z".repeat(40),
  );
});