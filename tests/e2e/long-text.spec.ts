import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T02 end to end: the long-text input on Q1, Q13 and Q15 against a real
// Postgres (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: the
// auto-growing textarea with no placeholder on any of the three, the Q1 counter
// that counts up to the 200-character minimum ("142 of 200" style, never "58
// remaining"), Q13's single-choice cause control below the textarea holding
// both halves together, and Continue unblocking only on a non-empty answer.

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
  // every question URL is reachable, matching the F03-T01 shell setup.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Long Text', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Long Text Person', $3, 'LGTX1', false, now())`,
    [RESPONDENT, COHORT, `long-text-e2e-${run}`],
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

const LONG_BLOCK =
  "Children with developmental delay in the Philippines wait months for an assessment and then travel hours each way for weekly sessions, and most give up before their child ever starts therapy. We exist so that waiting and distance stop being the reasons a child never gets care. A parent in Cavite waits four to six months for a developmental assessment, then travels two hours each way for weekly sessions with no way to know whether it is working, and the family simply stops coming. This answer is deliberately written long enough that it has to wrap far beyond the six visible lines of the field, so the auto-growing textarea demonstrably grows to fit the whole answer without letting any of it clip.";

test("Q1 renders an auto-growing textarea with a counter that counts up to 200, no placeholder", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/1");

  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible();
  await expect(textarea).toBeEnabled();

  // No placeholder — a placeholder anchors as hard as a worked example does.
  expect(await textarea.evaluate((el) => el.hasAttribute("placeholder"))).toBe(
    false,
  );

  // Counter counts up to the minimum, starting from 0.
  await expect(page.getByTestId("long-text-counter")).toHaveText("0 of 200");

  await textarea.fill("why we exist");
  await expect(page.getByTestId("long-text-counter")).toHaveText("12 of 200");

  // The exact acceptance wording: a plain count of the running total, not a
  // "remaining" number looking down from a cap.
  const label = await page.getByTestId("long-text-counter").textContent();
  expect(label).toMatch(/^\d+ of 200$/);
  expect(label).not.toContain("remaining");
});

test("typing into Q1 grows the field and unblocks Continue", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/1");

  const textarea = page.locator("textarea");
  const before = await textarea.boundingBox();

  const continueButton = page.getByRole("button", { name: "Continue" });
  // Unanswered required question blocks Continue with a reason.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/1$/);

  await textarea.fill(LONG_BLOCK);
  const after = await textarea.boundingBox();
  expect(after!.height).toBeGreaterThan(before!.height);

  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/2$/);
});

test("Q13 renders the single-choice cause below the textarea and holds both together", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/13");

  await expect(page.locator("textarea")).toBeVisible();
  // No placeholder on Q13 either.
  const textarea = page.locator("textarea");
  expect(await textarea.evaluate((el) => el.hasAttribute("placeholder"))).toBe(
    false,
  );

  // Exactly the nine causes from the baseline, rendered as a radio group.
  await expect(page.getByTestId("q13-cause")).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(9);
  const cause = page.getByLabel("ran out of money");
  await cause.check();
  await expect(cause).toBeChecked();

  // Selecting a cause alone is not an answer — Q13 requires the long text.
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/13$/);

  // Writing the explanation while the cause stays selected: the component
  // holds the free text and the selected cause together, and the answer then
  // unblocks Continue.
  await textarea.fill("We ran out of money and nobody said so out loud.");
  await expect(cause).toBeChecked();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/14$/);
});

test("Q15 is long text with no placeholder and no counter", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/15");

  const textarea = page.locator("textarea");
  await expect(textarea).toBeVisible();
  expect(await textarea.evaluate((el) => el.hasAttribute("placeholder"))).toBe(
    false,
  );

  // No minimum on Q15, so no counter.
  await expect(page.getByTestId("long-text-counter")).toHaveCount(0);
  // Q15 is the last screen, so there is no Continue (it is optional and has no
  // forward target on its own screen; skipping is covered by canAdvance).
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});