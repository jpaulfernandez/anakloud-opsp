import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T09 end to end: the capped multi-select + hours slider + private field
// input (Q14) against a real Postgres (same opt-in as the other DB-gated
// integration specs — SKIP unless DATABASE_URL and SESSION_SECRET are present).
// It covers the ticket: exactly sixteen function chips rendered uniformly; the
// at-most-three cap where tapping a dimmed chip produces "Pick at most 3 —
// swap one out." rather than a silent no-op; the hours slider that starts
// unset (no thumb position, big readout a dash) and pairs with a numeric input;
// one short field per teammate with names pre-filled from the cohort roster
// (two in this cohort, so the respondent sees two named rows); and the private
// (d) field as a distinct inset panel carrying the §4.11(d) copy verbatim.
//
// The Q14(d) private-row write (["q14d", not inside the q14 payload]) is a
// persist-time concern proven by the F01-T03 integration suite
// (tests/unit/private-rows.integration.test.ts) against a real Postgres; the
// unit test here keeps `private_note` a separate key, and the e2e covers the
// copy and the optionality on screen.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();
const TEAMMATE_A = randomUUID();
const TEAMMATE_B = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Q14', 'Q4 2026', 'open')",
    [COHORT],
  );
  // Three acknowledged, unsubmitted respondents in the same cohort: the one the
  // interaction tests use, plus two teammates for the roster-prefilled (b) rows.
  const respondents = [
    [RESPONDENT, "Q14 Main Person", "Q141"],
    [TEAMMATE_A, "Ana Reyes", "Q14A"],
    [TEAMMATE_B, "Benito Cruz", "Q14B"],
  ];
  for (const [id, name, resume] of respondents) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, $3, $4, $5, false, now())`,
      [id, COHORT, name, `${name.toLowerCase().replace(/\s+/g, "")}-${run}`, resume],
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

test("renders exactly sixteen function chips", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/14");

  const chips = page.getByTestId("function-chips");
  await expect(chips).toBeVisible();
  await expect(chips.getByRole("button")).toHaveCount(16);
  // The first, a middle and the last, by their baseline labels.
  await expect(chips.getByRole("button", { name: "product" })).toBeVisible();
  await expect(
    chips.getByRole("button", { name: "data privacy & security" }),
  ).toBeVisible();
  await expect(chips.getByRole("button", { name: "hiring" })).toBeVisible();
});

test("the cap dims the rest, and tapping a dimmed chip shows the cap line — never a no-op", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/14");

  const chips = page.getByTestId("function-chips");

  const first = chips.getByRole("button", { name: "product" });
  const second = chips.getByRole("button", { name: "backend" });
  const third = chips.getByRole("button", { name: "qa" });
  const fourth = chips.getByRole("button", { name: "design/UX" });

  await first.click();
  await second.click();
  await third.click();

  // Three selected; the fourth is now visually dimmed but still a real, tappable
  // control — dimming is visual only, because a dimmed chip must still respond
  // to a tap with the cap line (never a silent no-op).
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await expect(third).toHaveAttribute("aria-pressed", "true");
  await expect(fourth).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("cap-message")).toHaveCount(0);

  // Tapping the dimmed chip produces the exact §4.11 line and does not select it.
  await fourth.click();
  await expect(page.getByTestId("cap-message")).toHaveText(
    "Pick at most 3 — swap one out.",
  );
  await expect(fourth).toHaveAttribute("aria-pressed", "false");
  await expect(chips.locator('button[aria-pressed="true"]')).toHaveCount(3);

  // Deselecting one clears the cap message and re-enables selection.
  await first.click();
  await expect(page.getByTestId("cap-message")).toHaveCount(0);
  await fourth.click();
  await expect(fourth).toHaveAttribute("aria-pressed", "true");
});

test("the hours slider starts unset and pairs with the numeric input", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/14");

  const hoursValue = page.getByTestId("hours-value");

  // Unset: the big readout is a dash, the slider wrapper reports not-set, and a
  // range control has no committed value yet.
  await expect(hoursValue).toHaveText("—");
  await expect(page.locator(".q14-hours")).toHaveAttribute("data-set", "false");
  const range = page.getByRole("slider", { name: "Hours per week" });
  await expect(range).toHaveAttribute("aria-valuetext", "unset");

  // Setting the numeric input moves the slider's committed value and the readout.
  await page.getByLabel("Hours per week (number)").fill("30");
  await expect(hoursValue).toHaveText("30");
  await expect(page.locator(".q14-hours")).toHaveAttribute("data-set", "true");
  await expect(range).toHaveValue("30");
});

test("renders one short field per teammate with the roster names pre-filled", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/14");

  // Two teammates in the cohort (the respondent was excluded), each row named.
  await expect(
    page.getByRole("combobox", { name: "Ana Reyes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Benito Cruz" }),
  ).toBeVisible();
  // The acting respondent is not a row (a respondent does not name their own role).
  await expect(
    page.getByRole("combobox", { name: "Q14 Main Person" }),
  ).toHaveCount(0);

  // Each row starts at the empty "Not sure yet" option.
  await expect(
    page.getByRole("combobox", { name: "Ana Reyes" }),
  ).toHaveValue("");
});

test("renders the private field with the §4.11(d) copy and marks it optional", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/14");

  const panel = page.getByTestId("private-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByText("Only Paul sees this one.")).toBeVisible();
  await expect(
    page.getByText(
      "Not in any comparison, not in any export, not shown to the group.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Is there anything that would make you step back from this, that you haven't said out loud yet?",
    ),
  ).toBeVisible();
  // It states the field is optional, in the spec's own words.
  await expect(
    page.getByText("(leaving this blank is completely fine.)"),
  ).toBeVisible();
});

test("Continue blocks until the hours slider is set", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/14");

  const continueButton = page.getByRole("button", { name: "Continue" });
  // With no hours committed, Q14 is unanswered and Continue explains itself.
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/14$/);

  // A single committed hours value is the whole answer; the rest is up-to /
  // optional. Continue advances to Q15.
  await page.getByLabel("Hours per week (number)").fill("20");
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/15$/);
});