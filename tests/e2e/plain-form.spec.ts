import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F05-T06 end to end: the L3 plain-form mode, on the same opt-in as the other
// DB-backed integration specs, plus the facilitator pin itself. A pinned L3 is
// a plain questionnaire with no coach at all: every answer is accepted without
// evaluation, no card ever renders, and the respondent-facing DOM carries no
// reference to a coach, an outage or a degraded state (spec.md §7, PR6,
// ui_ux D3). Because the served level is resolved from AI_LEVEL_PIN by the
// shared web server, this spec opts in the same way the key-removal run does:
// run it with AI_LEVEL_PIN=L3 alongside the usual DB credentials.
//
//   AI_LEVEL_PIN=L3 DATABASE_URL=... SESSION_SECRET=... npx playwright test plain-form
//
//  - a coachable question (Q7) with a validator-failing answer advances with
//    no coach card — "accept every answer without evaluation"
//  - the L3 DOM contains no reference to a coach, an outage, or a degraded
//    state, and no "nudge" counter
//  - the §4.3 slot order at L3 is input, confidence, save — the coach slot is
//    gone, so a respondent cannot tell the questionnaire from one designed
//    without a coach

const enabled =
  process.env.DATABASE_URL !== undefined &&
  process.env.SESSION_SECRET !== undefined &&
  process.env.AI_LEVEL_PIN === "L3";

test.skip(
  !enabled,
  "requires DATABASE_URL, SESSION_SECRET and AI_LEVEL_PIN=L3",
);

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
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Plain Form', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Plain Person', $3, 'PLF1', false, now())`,
    [RESPONDENT, COHORT, `plain-form-e2e-${run}`],
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
    check at any coachable level. At L3 it must still advance with no card. */
const Q7_FAILING = "easy and simple and calm for every parent";

test("L3 accepts a validator-failing answer and advances with no coach card", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  await page.getByTestId("capped-short-text-input").fill(Q7_FAILING);
  await page.getByLabel("Confidence (number)").fill("3");
  await page.getByRole("button", { name: "Continue" }).click();

  // "Every answer accepted": no evaluation, no card, the screen simply advances.
  await expect(page).toHaveURL(/\/q\/8$/);
  await expect(page.getByTestId("coach-card")).toHaveCount(0);
  await expect(page.getByTestId("coach-closed")).toHaveCount(0);
});

test("the L3 respondent-facing DOM contains no coach, outage or degraded-state reference", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  // No card, no closing line, and no mention anywhere of a coach, its nudge
  // counter, or a degraded/outage state (PR6, ui_ux D3).
  await expect(page.getByTestId("coach-card")).toHaveCount(0);
  await expect(page.getByTestId("coach-closed")).toHaveCount(0);
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("coach");
  expect(body).not.toContain("nudge");
  expect(body).not.toContain("degraded");
  expect(body).not.toContain("outage");
  expect(body).not.toContain("unavailable");
});

test("the L3 slot order omits the coach slot, looking like a coach-less questionnaire", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/7");

  const slotOrder = await page
    .locator("[data-slot]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-slot")));
  expect(slotOrder).toEqual(["input", "confidence", "save"]);

  // The question anatomy a respondent knows is otherwise intact — one heading,
  // the helper, an enabled Continue.
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});