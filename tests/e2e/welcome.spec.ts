import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F02-T04 end to end: a fresh invite lands on name entry, the welcome screen's
// copy matches ui_ux.md §4.1 word for word, Continue is unavailable with an
// empty name, and an email left blank still completes the flow. Live against a
// real Postgres because name entry persists onto a respondents row — so it
// SKIPS unless DATABASE_URL and SESSION_SECRET are present (the same opt-in as
// the other e2e tests). Each test drives its own respondent so fully-parallel
// workers never collide on the same row.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

function rid(): string {
  return randomUUID();
}
function inviteToken(tag: string): string {
  return `welcome-e2e-${tag}-${run}`;
}

// One respondent per test. All start with a blank display name (fresh: not yet
// through name entry) except claimNamed, which already holds a name so its
// claim is a "used" invite.
const R: Record<string, string> = {
  claimFresh: rid(),
  claimNamed: rid(),
  copy: rid(),
  continueDisabled: rid(),
  emailBlank: rid(),
  continuous: rid(),
};
const TOKEN: Record<string, string> = {
  claimFresh: inviteToken("claimFresh"),
  claimNamed: inviteToken("claimNamed"),
};

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Welcome', 'Q4 2026', 'open')",
    [COHORT],
  );
  for (const [tag, id] of Object.entries(R)) {
    const named = tag === "claimNamed";
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, $3, $4, 'WELCOM', false, case when $5 then now() end)`,
      [
        id,
        COHORT,
        named ? "Existing Person" : "",
        inviteToken(tag),
        // claimNamed models a returning respondent who has been through the
        // whole onboarding, so their claim restores the session at "/" rather
        // than re-showing name entry or the ground rules.
        named,
      ],
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

async function openWelcome(page: Page, respondentId: string) {
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
  await page.goto("/welcome");
}

test("a fresh invite link lands on name entry", async ({ page }) => {
  await page.goto(`/claim?token=${TOKEN.claimFresh}`);
  await expect(page).toHaveURL(/\/welcome$/);
  await expect(
    page.getByRole("heading", { level: 2, name: "Before we start." }),
  ).toBeVisible();
});

test("a used invite restores the session instead of re-asking for a name", async ({
  page,
}) => {
  await page.goto(`/claim?token=${TOKEN.claimNamed}`);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 2, name: "Before we start." }))
    .toHaveCount(0);
});

test("the welcome copy matches ui_ux.md §4.1 word for word", async ({ page }) => {
  await openWelcome(page, R.copy);

  await expect(page.getByText("Before we start.")).toBeVisible();
  await expect(
    page.getByText(
      "This is a set of questions about Anakloud — where it's going, who it's for, what has to happen next. Everyone answers on their own, before we talk as a group.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("There are no right answers and this isn't a test.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "If your answer is different from everyone else's, that's the single most useful thing that can come out of this.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Takes about 25 minutes. You can stop anytime and come back — nothing gets lost."),
  ).toBeVisible();
  await expect(page.getByText("so we can resend your link if you lose it")).toBeVisible();
});

test("Continue is unavailable with an empty name", async ({ page }) => {
  await openWelcome(page, R.continueDisabled);

  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();

  // A name is the only gate — typing anything enables it.
  await page.getByLabel("Your name").fill("Benito Cruz");
  await expect(continueButton).toBeEnabled();
});

test("email left blank completes the flow", async ({ page }) => {
  await openWelcome(page, R.emailBlank);

  await page.getByLabel("Your name").fill("Carla Santos");
  // Email is optional and left blank — completing must not require it.
  await page.getByRole("button", { name: "Continue" }).click();

  // Name entry advances to the ground-rules gate (F02-T05).
  await expect(page).toHaveURL(/\/ground-rules$/);
  const row = await db!.query(
    "select display_name, email from respondents where id = $1",
    [R.emailBlank],
  );
  expect(row.rows[0].display_name).toBe("Carla Santos");
  expect(row.rows[0].email).toBeNull();
});

test("a name is accepted regardless of script or spelling", async ({ page }) => {
  await openWelcome(page, R.continuous);

  // FR-2 SHALL NOT on validating language/script/spelling: this name includes
  // non-Latin script and needs no spelling check to be accepted. Name entry
  // advances to the ground-rules gate (F02-T05).
  await page.getByLabel("Your name").fill("李 明");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/ground-rules$/);
  const row = await db!.query("select display_name from respondents where id = $1", [
    R.continuous,
  ]);
  expect(row.rows[0].display_name).toBe("李 明");
});