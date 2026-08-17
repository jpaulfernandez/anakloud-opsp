import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T03 end to end: the sentence-completion input on Q2 against a real
// Postgres (same opt-in as the other DB-gated integration specs — SKIP unless
// DATABASE_URL and SESSION_SECRET are present). It covers the ticket: on a wide
// viewport the two blanks render inline as underlined runs inside the sentence,
// at 360px they stack vertically each carrying its sentence fragment as a
// visible label, the sentence structure (not two anonymous boxes) is what a
// screen reader announces, and a sentence with an empty half leaves the
// required question blocking Continue.

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
  // the Q2 URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Sentence Completion', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Sentence Person', $3, 'SNT1', false, now())`,
    [RESPONDENT, COHORT, `sentence-completion-e2e-${run}`],
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

test("wide viewport renders the two blanks inline inside the sentence", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/2");

  // The inline presentation runs both inputs in the sentence text (ui_ux §4.5).
  // Both presentations exist in the DOM and a responsive class shows one; scope
  // any locators to the inline container so hidden (mobile) inputs don't leak.
  const inline = page.getByTestId("q2-sentence-inline");
  await expect(inline).toBeVisible();
  await expect(inline).toContainText(
    "The people who would miss it most are",
  );
  await expect(inline).toContainText("because");

  // Two inputs, one per blank, both reachable by label within the sentence.
  await expect(
    inline.getByLabel("The people who would miss it most are"),
  ).toHaveCount(1);
  await expect(inline.getByLabel("because")).toHaveCount(1);

  // The stacked (mobile) presentation is hidden on a wide viewport.
  await expect(page.getByTestId("q2-sentence-stacked")).toBeHidden();
});

test("at 360px each field carries its sentence fragment as a visible label", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/q/2");

  // Stacked presentation with a visible label above each field — never two
  // anonymous boxes (ui_ux §4.5, the acceptance criterion). Locators are
  // scoped to the stacked container so the hidden inline inputs don't leak.
  const stacked = page.getByTestId("q2-sentence-stacked");
  await expect(stacked).toBeVisible();
  await expect(stacked.locator("input")).toHaveCount(2);
  await expect(page.getByTestId("q2-who-label")).toBeVisible();
  await expect(page.getByTestId("q2-because-label")).toBeVisible();

  // The inline (desktop) presentation is hidden at 360px.
  await expect(page.getByTestId("q2-sentence-inline")).toBeHidden();

  // Each field's accessible name is its sentence fragment, so a screen reader
  // announces the sentence structure rather than two generic text fields.
  await expect(stacked.getByLabel("The people who would miss it most are")).toBeVisible();
  await expect(stacked.getByLabel("because")).toBeVisible();
});

test("the required sentence blocks Continue until both blanks are filled", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/2");

  // The default viewport is wide; scope to the inline presentation for input.
  const inline = page.getByTestId("q2-sentence-inline");
  const continueButton = page.getByRole("button", { name: "Continue" });

  // Empty sentence blocks with the explanatory line.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/2$/);

  // Filling only one blank still does not answer the sentence.
  const who = inline.getByLabel("The people who would miss it most are");
  await who.fill("Therapy center admins");
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/2$/);

  // Both blanks filled advances to the next question.
  const because = inline.getByLabel("because");
  await because.fill("they'd go back to schedules by hand");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/3$/);
});