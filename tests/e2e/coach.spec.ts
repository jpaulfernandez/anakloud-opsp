import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F05-T04 end to end: the coach card and nudge state machine, on the same
// opt-in as the other DB-backed integration specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). It covers the ticket's acceptance criteria in
// their own terms:
//
//   - "Keep it as is" is present and functional on nudge 1
//   - a needs_work verdict never leaves Continue unavailable (PR4 / D2)
//   - tapping Continue twice on identical text advances on the second tap
//   - a passing answer produces no visible coach output at all
//   - focus remains in the answer field when the card appears
//   - three nudges on one question, then the card becomes the closing line and
//     the coach never returns for that question (FR-17, ui_ux §5.2)
//
// Questions used: Q7 (capped short text, coachable, no example) for the nudge
// flow; Q6 (coachable, not confidence-bearing) for the focus-in-textarea check;
// Q3 (coachable, confidence-bearing) for the passing-answer silence check.

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

  // One acknowledged, unsubmitted respondent so every question URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Coach', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Coach Person', $3, 'COC1', false, now())`,
    [RESPONDENT, COHORT, `coach-e2e-${run}`],
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

/** A Q7 answer with more than one conjunction — fails the §6.3 single-promise
    check while still being a full, answered field. */
const Q7_FAILING = "easy and simple and calm for every parent";
const Q7_PASSING = "one calm shared record each family trusts";

async function setConfidence(page: Page) {
  await page.getByLabel("Confidence (number)").fill("3");
}

/** Fill Q7's capped field and the required confidence ring, then Continue. */
async function q7AnswerAndContinue(page: Page, answer: string) {
  await page.getByTestId("capped-short-text-input").fill(answer);
  await setConfidence(page);
  await page.getByRole("button", { name: "Continue" }).click();
}

test("a needs_work answer shows the coach card with 'Keep it as is' on nudge 1, and Continue stays enabled", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  await q7AnswerAndContinue(page, Q7_FAILING);

  // The card appears below the field with the honest counter and all three
  // actions, and Continue remains live (PR4 most forcibly: a coach verdict must
  // never leave Continue unavailable).
  const card = page.getByTestId("coach-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("nudge 1 of 3");
  await expect(
    card.getByRole("button", { name: /Keep it as is/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await expect(page).toHaveURL(/\/q\/7$/);
});

test("'Keep it as is' on nudge 1 advances without revising", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/7");

  await q7AnswerAndContinue(page, Q7_FAILING);

  await page
    .getByTestId("coach-card")
    .getByRole("button", { name: /Keep it as is/ })
    .click();

  await expect(page).toHaveURL(/\/q\/8$/);
});

test("tapping Continue twice on identical text advances on the second tap", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  await q7AnswerAndContinue(page, Q7_FAILING);
  await expect(page.getByTestId("coach-card")).toBeVisible();

  // Same field, same text: the coach never re-evaluates an unchanged answer, so
  // the second tap treats it as kept as is and advances (ui_ux §5.2).
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/8$/);
});

test("a passing answer advances silently with no coach output", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/7");

  await q7AnswerAndContinue(page, Q7_PASSING);

  // The coach says nothing on success and the screen simply advances.
  await expect(page).toHaveURL(/\/q\/8$/);
  await page.goto("/q/7");
  await expect(page.getByTestId("coach-card")).toHaveCount(0);
});

test("focus remains in the reason field when the card appears", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/6");

  await page.getByRole("radio", { name: /Parent/ }).first().check();
  // A short (under-8-word) reason is answered but fails the coach's length
  // check, so the card appears while the textarea should stay focused.
  await page.getByLabel("One line: why").fill("just the parent");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByTestId("coach-card")).toBeVisible();
  await expect(page.getByLabel("One line: why")).toBeFocused();
});

test("three failing tries retire the coach with the closing line", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/7");

  const card = page.getByTestId("coach-card");
  const revise = () =>
    card.getByRole("button", { name: /Let me revise/ }).click();

  // Nudge 1.
  await q7AnswerAndContinue(page, Q7_FAILING);
  await expect(card).toContainText("nudge 1 of 3");

  // Change the answer and fail again → nudge 2.
  await revise();
  await page.getByTestId("capped-short-text-input").fill("fast and friendly and warm for everyone");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(card).toContainText("nudge 2 of 3");

  // Change again → nudge 3.
  await revise();
  await page.getByTestId("capped-short-text-input").fill("quick and neat and kind to every family");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(card).toContainText("nudge 3 of 3");

  // Dismissing the third nudge replaces the card with the closing line and the
  // coach never returns for this question (ui_ux §5.2).
  await revise();
  await expect(page.getByTestId("coach-closed")).toHaveText(
    "Fair enough — going with yours.",
  );
  await expect(card).toHaveCount(0);

  // Still failing (unchanged), the coach now steps aside and Continue advances.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/8$/);
});