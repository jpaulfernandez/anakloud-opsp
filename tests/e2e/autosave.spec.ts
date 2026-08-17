import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { withRespondentContext } from "../../lib/access";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F04-T02 end to end: debounced autosave and the persistent save slot,
// against a real Postgres (same opt-in as the other DB-gated e2e specs — SKIP
// unless DATABASE_URL and SESSION_SECRET are present). Covers the ticket's
// three acceptance criteria:
//
//   1. "✓ Saved" remains on screen indefinitely after a successful save.
//   2. Navigating quickly between questions never drops the last keystroke.
//   3. A forced 500 on the save endpoint does not block answering.
//
// The shell mounts one client component; these tests drive it exactly as a
// respondent would, and verify persistence server-side through the
// facilitator's RLS context. Each test gets its own respondent so fully-parallel
// runs never collide.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();

const R = {
  persistentSave: randomUUID(),
  quickNavigate: randomUUID(),
  forced500: randomUUID(),
} as const;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Autosave', 'Q4 2026', 'open')",
    [COHORT],
  );
  // Acknowledged, unsubmitted respondents (past the ground-rules gate) so every
  // question URL is reachable, matching the F03-T01 shell setup.
  for (const id of Object.values(R)) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, 'Autosave Person', $3, 'AUTOSV', false, now())`,
      [id, COHORT, `autosave-${id.slice(0, 8)}`],
    );
  }
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Facilitator', $3, 'FACAUT', true)`,
    [FACILITATOR, COHORT, `autosave-fac-${run}`],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
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

/** Read one respondent's answer rows as the cohort facilitator (bypass RLS). */
async function readAnswer(
  respondentId: string,
  questionId: string,
): Promise<unknown | null> {
  let value: unknown | null = null;
  await withRespondentContext(db!, FACILITATOR, async (tx) => {
    const res = await tx.query(
      "select value, confidence from answers where respondent_id = $1 and question_id = $2",
      [respondentId, questionId],
    );
    value = res.rows[0]?.value ?? null;
  });
  return value;
}

/** Poll the database until `questionId` for `respondentId` equals `expected`. */
async function expectSavedEventually(
  respondentId: string,
  questionId: string,
  expected: unknown,
) {
  await expect
    .poll(async () => {
      const value = await readAnswer(respondentId, questionId);
      return JSON.stringify(value);
    }, { timeout: 10_000 })
    .toBe(JSON.stringify(expected));
}

const LONG_BLOCK =
  "Children with developmental delay in the Philippines wait months for an assessment and then travel hours each way for weekly sessions, and most give up before their child ever starts therapy. We exist so that waiting and distance stop being the reasons a child never gets care, and so a parent in Cavite can begin to see their child progress without a two-hour commute eroding the household budget and the family's resolve to keep coming. This answer is long enough that it must be saved in full, every keystroke, no matter how fast the respondent moves on.";

test("the save slot shows '✓ Saved' and it persists in a fixed slot", async ({
  page,
}) => {
  await setSession(page, R.persistentSave);
  await page.goto("/q/1");

  // No save indicator before anything is typed.
  await expect(page.getByTestId("save-status")).toHaveCount(0);

  await page.locator("textarea").fill(LONG_BLOCK);
  await expect(page.getByTestId("save-status")).toHaveText("✓ Saved", {
    timeout: 10_000,
  });

  // A toast would fade; the slot must not. Hold the page still and confirm the
  // indicator is still there and still says the same thing.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId("save-status")).toHaveText("✓ Saved");

  // It lives in the fixed §4.3 "save" slot, not a floating toast or banner.
  await expect(page.locator('[data-slot="save"]')).toContainText("✓ Saved");

  // And the answer really persisted.
  await expectSavedEventually(R.persistentSave, "q1", { text: LONG_BLOCK });
});

test("navigating quickly between questions never drops the last keystroke", async ({
  page,
}) => {
  await setSession(page, R.quickNavigate);
  await page.goto("/q/1");

  const textarea = page.locator("textarea");
  await textarea.fill(LONG_BLOCK);

  // Advance immediately — long before the 600ms debounce could fire — so the
  // only way the answer is saved is the flush before the transition.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/2$/);

  // The full answer, not a truncated/older version, reached the server.
  await expectSavedEventually(R.quickNavigate, "q1", { text: LONG_BLOCK });
});

test("a forced 500 on the save endpoint does not block answering", async ({
  page,
}) => {
  // Every save attempt fails with a 500. Answering must keep working: the field
  // stays editable, no data-loss error appears, and Continue still advances.
  await page.route("**/api/answers", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.fulfill({ status: 500, body: "boom" });
    } else {
      await route.fallback();
    }
  });

  await setSession(page, R.forced500);
  await page.goto("/q/1");

  const textarea = page.locator("textarea");
  await textarea.fill(LONG_BLOCK);
  // Input still accepts more after a failed save (answering is not blocked).
  await textarea.fill(`${LONG_BLOCK} Amended.`);
  await expect(textarea).toHaveValue(`${LONG_BLOCK} Amended.`);

  // No failure message that implies data loss surfaced in the save slot.
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Not saved");
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Error");
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Failed");

  // Continue still advances despite the failing save — the save is not on the
  // critical path (ui_ux §6).
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/2$/);
});