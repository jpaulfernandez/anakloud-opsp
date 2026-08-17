import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T07 end to end: the tap-to-assign ranking input (Q8) against a real
// Postgres (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: tapping
// pool cards builds an ordered list with position numbers, ✕ returns a card to
// the pool and renumbers the rest, the pool order is randomised per respondent
// within a cohort, Continue stays blocked until every half of the question (the
// order, the delete choice, the why and the predicted ranking) is present, and
// the whole thing is completable both with one thumb at 360px and with a
// keyboard alone.
//
// The "pool order differs between two respondents" acceptance is fully
// deterministic here because the shuffle is seeded per respondent: two distinct
// respondent ids in the same cohort produce two distinct pool orders, asserted
// directly below.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();
const RESPONDENT_A = randomUUID();
const RESPONDENT_B = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Ranking', 'Q4 2026', 'open')",
    [COHORT],
  );
  // Three acknowledged, unsubmitted respondents in the same cohort: the one the
  // interaction tests use, plus two whose pool orders are compared.
  const respondents = [
    [RESPONDENT, "Rank Main Person", "RNK1"],
    [RESPONDENT_A, "Rank Person A", "RNKA"],
    [RESPONDENT_B, "Rank Person B", "RNKB"],
  ];
  for (const [id, name, resume] of respondents) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, $3, $4, $5, false, now())`,
      [id, COHORT, name, `${name.toLowerCase()}-${run}`, resume],
    );
  }
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
  const sessionToken = createSessionToken({
    respondentId,
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

/** The pool card labels, in their on-screen (per-respondent) order. */
async function readPoolOrder(page: Page): Promise<string[]> {
  const texts = await page
    .getByTestId("rank-pool")
    .getByRole("button")
    .allTextContents();
  return texts.map((t) => t.trim());
}

/** Tap every pool card once, in whatever order the pool currently shows. */
async function tapAllPoolCards(page: Page) {
  const pool = page.getByTestId("rank-pool");
  const count = await pool.getByRole("button").count();
  for (let i = 0; i < count; i++) {
    await pool.getByRole("button").nth(0).click();
  }
}

/** Expand the collapsed predicted-ranking control and assign every card. */
async function completePredicted(page: Page) {
  await page
    .getByRole("button", { name: "What do you think the group's #1 will be?" })
    .click();
  const predicted = page.getByTestId("predicted-pool");
  await expect(predicted).toBeVisible();
  const count = await predicted.getByRole("button").count();
  for (let i = 0; i < count; i++) {
    await predicted.getByRole("button").nth(0).click();
  }
}

test("the pool order differs between two respondents in the same cohort", async ({
  browser,
}) => {
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();
  try {
    await setSession(pageA, RESPONDENT_A);
    await setSession(pageB, RESPONDENT_B);
    await pageA.goto("/q/8");
    await pageB.goto("/q/8");

    const orderA = await readPoolOrder(pageA);
    const orderB = await readPoolOrder(pageB);

    // Both are a full permutation of the four apps (nothing lost or duplicated).
    expect([...orderA].sort()).toEqual([...orderB].sort());
    expect(orderA.length).toBe(4);
    // And the two respondents do NOT see the same fixed default order.
    expect(orderA).not.toEqual(orderB);
  } finally {
    await pageA.close();
    await pageB.close();
  }
});

test("the ranking is completable with one thumb at 360px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await setSession(page, RESPONDENT);
  await page.goto("/q/8");

  const pool = page.getByTestId("rank-pool");
  const ordered = page.getByTestId("rank-ordered");

  // The seeded per-respondent pool order, captured before anything is tapped:
  // the first card tapped becomes order[0], the second order[1], etc.
  const initialOrder = await readPoolOrder(page);

  // Empty pool* is a full set; not answered until a full order + delete + why
  // + prediction are present, so Continue blocks and explains itself.
  await expect(pool.getByRole("button")).toHaveCount(4);
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/8$/);

  // Tap to assign: each tap moves a card into the ordered list, number shown.
  await pool.getByRole("button").first().click();
  await expect(ordered).toHaveText(/#1/);
  await pool.getByRole("button").first().click();
  await expect(ordered).toHaveText(/#2/);

  // ✕ returns an item to the pool and renumbers the remainder.
  const removedLabel = initialOrder[0];
  const removeButton = ordered
    .locator("li")
    .first()
    .getByRole("button", { name: /Remove .* from the order/ });
  await removeButton.click();
  await expect(ordered.locator("li")).toHaveCount(1);
  await expect(ordered).toHaveText(/#1/);
  await expect(pool).toContainText(removedLabel);

  // Reassign it, then tap the remaining cards to complete a full order of all
  // four apps.
  await pool.getByRole("button").first().click();
  await expect(ordered.locator("li")).toHaveCount(2);
  await tapAllPoolCards(page);
  await expect(ordered.locator("li")).toHaveCount(4);
  await expect(pool.getByRole("button")).toHaveCount(0);

  await page.getByRole("radio", { name: /Fourth app|PedConnect|TeachDay|ParentUp/ }).first().check();
  await page.getByRole("textbox", { name: "One line why" }).fill("it never opens a door");

  // Still blocked: the predicted ranking is missing.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/8$/);

  // Complete the collapsed predicted-ranking control.
  await completePredicted(page);

  // Q8 also carries a required confidence ring (F03-T11, FR-11): a complete
  // ranking with no ring is still refused, with its own explanatory line.
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByText("Let us know how confident you are, from 1 to 5, before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/8$/);

  // Setting the ring lets Continue advance.
  await page.getByLabel("Confidence (number)").fill("3");
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/9$/);
});

test("the ranking is completable with keyboard only", async ({ page }) => {
  await setSession(page, RESPONDENT);
  await page.goto("/q/8");

  const pool = page.getByTestId("rank-pool");
  const ordered = page.getByTestId("rank-ordered");
  const initialOrder = await readPoolOrder(page);

  // Assign every card by focusing each pool button and pressing Enter — no
  // pointer involved. Rank ends up [initialOrder[0..3]].
  const poolCount = await pool.getByRole("button").count();
  for (let i = 0; i < poolCount; i++) {
    await pool.getByRole("button").nth(0).focus();
    await page.keyboard.press("Enter");
  }
  await expect(ordered.locator("li")).toHaveCount(4);

  // Reorder with the up control: move the last item (initialOrder[3]) up one,
  // so its position number changes and the edit is pointer-free.
  await ordered
    .locator("li")
    .last()
    .getByRole("button", { name: /Move .* up/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(ordered.locator("li").nth(2)).toContainText(initialOrder[3]);

  // Remove one item (initialOrder[0]) with ✕ (keyboard again) and re-add it.
  await ordered
    .locator("li")
    .first()
    .getByRole("button", { name: /Remove .* from the order/ })
    .focus();
  await page.keyboard.press("Enter");
  await expect(ordered.locator("li")).toHaveCount(3);
  await pool.getByRole("button").nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(ordered.locator("li")).toHaveCount(4);

  // Delete radio + why by keyboard.
  await page
    .getByRole("radio", { name: /Fourth app|PedConnect|TeachDay|ParentUp/ })
    .first()
    .focus();
  await page.keyboard.press("Space");
  const why = page.getByRole("textbox", { name: "One line why" });
  await why.focus();
  await page.keyboard.type("the one nobody reaches for");

  // The collapsed prediction, expanded and filled by keyboard.
  await page
    .getByRole("button", { name: "What do you think the group's #1 will be?" })
    .focus();
  await page.keyboard.press("Enter");
  const predicted = page.getByTestId("predicted-pool");
  const predictedCount = await predicted.getByRole("button").count();
  for (let i = 0; i < predictedCount; i++) {
    await predicted.getByRole("button").nth(0).focus();
    await page.keyboard.press("Enter");
  }

  // The confidence ring is also required (F03-T11, FR-11), set by keyboard.
  const confidenceNumber = page.getByLabel("Confidence (number)");
  await confidenceNumber.focus();
  await page.keyboard.type("4");
  await expect(page.getByRole("slider", { name: "Confidence" })).toHaveValue("4");

  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/q\/9$/);
});

test("a screen reader hears position changes via the live region", async ({ page }) => {
  await setSession(page, RESPONDENT);
  await page.goto("/q/8");

  const status = page.getByRole("status");

  // Assigning a card announces its freshly-computed position. The pool's first
  // card becomes number 1, so the live region carries that announcement.
  await page.getByTestId("rank-pool").getByRole("button").first().focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText(/is number 1/);
});