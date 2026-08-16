import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T06 end to end: the single-choice + required-reason input (Q6) against a
// real Postgres (same opt-in as the other DB-gated integration specs — SKIP
// unless DATABASE_URL and SESSION_SECRET are present). It covers the ticket:
// the four-option radio group with a reason textarea that is inert before a
// choice is made, Continue staying blocked with the specific §4.9 line ("Add a
// line about why") instead of the generic unanswered message, and the reason
// being required — a bare choice does not unblock Continue.

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
  // the Q6 URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Single Choice Reason', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Single Choice Person', $3, 'SCR1', false, now())`,
    [RESPONDENT, COHORT, `single-choice-reason-e2e-${run}`],
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

test("the reason field is inert before a choice is made", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/6");

  // The four radio options from the registry render.
  const group = page.getByTestId("single-choice-reason");
  await expect(group).toBeVisible();
  for (const label of ["Center", "Parent", "Pediatrician", "Therapist"]) {
    await expect(group.getByRole("radio", { name: label })).toBeVisible();
  }

  // The reason textarea is disabled until a choice is picked (ui_ux §4.9).
  const reason = group.getByRole("textbox", { name: "One line: why" });
  await expect(reason).toBeDisabled();
  await expect(group.getByRole("radio")).toHaveCount(4);
});

test("Continue stays blocked with the specific §4.9 line, and a bare choice still blocks", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/6");

  const group = page.getByTestId("single-choice-reason");
  const continueButton = page.getByRole("button", { name: "Continue" });
  const reason = group.getByRole("textbox", { name: "One line: why" });

  // Blocked before anything is chosen: the reason is the required half, so the
  // line is the specific one — never the generic "Answer this before moving
  // on." and never just a greyed-out button (F03-T01).
  await continueButton.click();
  await expect(page.getByText("Add a line about why")).toBeVisible();
  await expect(page.getByText("Answer this before moving on.")).toHaveCount(0);
  await expect(page).toHaveURL(/\/q\/6$/);

  // Choosing a side enables the reason but, without a reason, still blocks.
  await group.getByRole("radio", { name: "Center" }).check();
  await expect(reason).toBeEnabled();
  await continueButton.click();
  await expect(page.getByText("Add a line about why")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/6$/);

  // "we serve everyone" is not an available answer; a bare choice is incomplete.
  await expect(group.getByRole("radio")).toHaveCount(4);
});

test("Q6 completes only with a chosen side and a reason", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/6");

  const group = page.getByTestId("single-choice-reason");
  const continueButton = page.getByRole("button", { name: "Continue" });
  const reason = group.getByRole("textbox", { name: "One line: why" });

  await group.getByRole("radio", { name: "Parent" }).check();
  await reason.fill("Demand comes from parents; centers adopt what they ask for.");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/7$/);
});