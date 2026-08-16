import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T11 end to end: the confidence slider on the six FR-11 questions against
// a real Postgres (same opt-in as the other DB-gated integration specs — SKIP
// unless DATABASE_URL and SESSION_SECRET are present). It covers the ticket:
// the 1–5 slider plus its paired numeric input appear on Q3, Q4, Q7, Q8, Q10
// and Q11 and nowhere else; the ring starts unset (no thumb position, blank
// numeric field) rather than anchoring to a middle value; setting the numeric
// input moves the slider and vice versa; and a confidence question whose input
// is complete is still refused Continue, with an explanatory line, until a
// value is set.
//
// The "exactly six, asserted against the registry" acceptance is pinned by the
// unit test (tests/unit/confidence.test.ts) against lib/questions.ts; the e2e
// confirms the component actually renders on those six and not on others.

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
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Confidence', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Confidence Person', $3, 'CNF1', false, now())`,
    [RESPONDENT, COHORT, `confidence-e2e-${run}`],
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

const slider = (page: Page) => page.getByRole("slider", { name: "Confidence" });
const numeric = (page: Page) => page.getByLabel("Confidence (number)");

test("the slider appears on exactly the six FR-11 questions and nowhere else", async ({
  page,
}) => {
  await setSession(page);

  for (const id of [3, 4, 7, 8, 10, 11]) {
    await page.goto(`/q/${id}`);
    await expect(slider(page), `/q/${id} carries a confidence slider`).toBeVisible();
    await expect(numeric(page), `/q/${id} carries the numeric pair`).toBeVisible();
  }

  // The confidence questions are a strict subset: a non-confidence screen has
  // no slider and no numeric pair.
  for (const id of [2, 5, 6, 9, 12]) {
    await page.goto(`/q/${id}`);
    await expect(slider(page), `/q/${id} has no confidence slider`).toHaveCount(0);
    await expect(numeric(page), `/q/${id} has no numeric pair`).toHaveCount(0);
  }
});

test("the ring starts unset, showing no committed value", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/3");

  // Unset: no thumb position, blank numeric field, wrapper reports not-set.
  const ring = page.locator(".confidence");
  await expect(ring).toHaveAttribute("data-set", "false");
  await expect(numeric(page)).toHaveValue("");
  await expect(slider(page)).toHaveAttribute("aria-valuetext", "unset");
});

test("setting the numeric input moves the slider and vice versa", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/3");

  // numeric → slider.
  await numeric(page).fill("4");
  await expect(slider(page)).toHaveValue("4");
  await expect(page.locator(".confidence")).toHaveAttribute("data-set", "true");

  // slider → numeric, by keyboard (ArrowLeft walks 4 → 3 on the range).
  await slider(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(slider(page)).toHaveValue("3");
  await expect(numeric(page)).toHaveValue("3");
});

test("a complete Q7 is still refused Continue until the ring is set", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  // Q7's one short-text line is a full answer, but the confidence ring is a
  // separate required part (FR-11): Continue explains itself rather than
  // advancing.
  await page
    .getByTestId("capped-short-text-input")
    .fill("show the parent, the therapist and the referring doctor the same record");
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(
    page.getByText("Let us know how confident you are, from 1 to 5, before moving on."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/q\/7$/);

  // Setting the ring advances.
  await numeric(page).fill("4");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/8$/);
});