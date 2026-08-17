import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F02-T05 end to end: the ground-rules gate between name entry and the first
// question. The copy matches ui_ux.md §4.2 word for word; Continue is gated on
// the "Got it" acknowledgement; the acknowledgement is recorded once and never
// re-shows on resume; and direct navigation to a question URL before
// acknowledgement redirects to the ground-rules screen (FR-5). Live against a
// real Postgres because the acknowledgement persists onto a respondents row —
// so it SKIPS unless DATABASE_URL and SESSION_SECRET are present (the same
// opt-in as the other e2e tests). Each test drives its own, separately-seeded
// respondent so fully-parallel workers never collide, and no test depends on
// another's side effects.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

function rid(): string {
  return randomUUID();
}

// All respondents carry a display name (they've been through name entry,
// F02-T04). The split is the ground-rules acknowledgement: `gates`, `copy` and
// `submit` have not acknowledged yet (so the gate is live for them), while
// `resume` has (so a used invite reaches its destination without re-showing).
const R: Record<string, string> = {
  gates: rid(),
  copy: rid(),
  submit: rid(),
  resume: rid(),
};
const ACKNOWLEDGED: Record<string, boolean> = {
  gates: false,
  copy: false,
  submit: false,
  resume: true,
};

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Ground Rules', 'Q4 2026', 'open')",
    [COHORT],
  );
  for (const [tag, id] of Object.entries(R)) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, 'Person', $3, 'GRULE', false, case when $4 then now() end)`,
      [id, COHORT, `ground-e2e-${tag}-${run}`, ACKNOWLEDGED[tag]],
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

test("direct navigation to /q/7 before acknowledgement redirects to the ground-rules screen", async ({
  page,
}) => {
  await setSession(page, R.gates);
  await page.goto("/q/7");
  await expect(page).toHaveURL(/\/ground-rules$/);
});

test("an acknowledged respondent reaches the question instead of being gated", async ({
  page,
}) => {
  await setSession(page, R.resume);
  await page.goto("/q/7");
  await expect(page).toHaveURL(/\/q\/7$/);
});

test("the ground-rules copy matches ui_ux.md §4.2 word for word", async ({ page }) => {
  await setSession(page, R.copy);
  await page.goto("/ground-rules");

  await expect(page.getByText("This is a baseline, not a decision.")).toBeVisible();
  await expect(page.getByText("Nothing you write here becomes policy.")).toBeVisible();
  await expect(page.getByText("Answer before you talk to anyone.")).toBeVisible();
  await expect(page.getByText("If you and Ern discuss it first, we've lost the point.")).toBeVisible();
  await expect(
    page.getByText("Your answers will be shown side by side with everyone else's"),
  ).toBeVisible();
  await expect(page.getByText("without names, when we meet.")).toBeVisible();
  await expect(page.getByText("One question at the end is private")).toBeVisible();
  await expect(page.getByText("only Paul sees it.")).toBeVisible();
  await expect(
    page.getByText("Taglish is completely fine. Write it how you'd actually say it."),
  ).toBeVisible();
});

test("the acknowledgement gates Continue and is recorded once", async ({ page }) => {
  await setSession(page, R.submit);
  await page.goto("/ground-rules");

  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();

  // The checkbox is the acknowledgement: nothing advances until it's checked.
  await page.getByLabel("Got it").check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(page).toHaveURL(/\/$/);
  const row = await db!.query(
    "select ground_rules_acknowledged_at from respondents where id = $1",
    [R.submit],
  );
  expect(row.rows[0].ground_rules_acknowledged_at).not.toBeNull();
});

test("acknowledgement persists across sessions and devices, so resume does not re-show the screen", async ({
  browser,
}) => {
  // A brand-new context and a fresh cookie for an already-acknowledged
  // respondent stand in for a second device or a later session.
  const context = await browser.newContext();
  const page = await context.newPage();
  await setSession(page, R.resume);

  // Reaching /ground-rules once acknowledged does not re-show the screen.
  await page.goto("/ground-rules");
  await expect(page).toHaveURL(/\/$/);

  // And a question URL is no longer gated.
  await page.goto("/q/7");
  await expect(page).toHaveURL(/\/q\/7$/);

  await context.close();
});