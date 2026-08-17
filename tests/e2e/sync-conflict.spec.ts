import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { withRespondentContext } from "../../lib/access";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F04-T04 end to end: sync conflict resolution, against a real Postgres (same
// opt-in as the other DB-gated e2e specs — SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's acceptance criteria:
//
//   1. Two tabs editing the same question converge without data loss — each
//      tab's local content is kept (local wins on content), the server ends up
//      with one coherent value (last write wins), and no data-loss surface
//      appears in either tab.
//   2. Submitting in tab A and typing in tab B does not silently erase tab B's
//      text — once the server reports locked (PR5), a 409 stops the retry
//      forever and tab B's unsaved text is surfaced read-only so it is not lost
//      without the respondent's knowledge.
//
// The locked scenario is modelled as a respondent whose `submitted_at` is set
// directly in the fixture (the submit flow itself is F06; the server-side 409
// is F04-T01 and already tested). The read-only surface is what this ticket
// adds.

const enabled =
  process.env.DATABASE_URL !== undefined &&
  process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();

const R = {
  multiTab: randomUUID(),
  locked: randomUUID(),
} as const;

const ANSWER_A =
  "The assessment pipeline is where families wait longest and where the fix lands.";
const ANSWER_B =
  "More therapists on the ground is the real constraint, not the waiting list itself.";
const LOCKED_TYPED =
  "I was still editing this when my answers locked — please don't let this vanish.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Sync Conflict', 'Q4 2026', 'open')",
    [COHORT],
  );
  // An acknowledged, unlocked respondent for the two-tab test.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'MultiTab Person', $3, 'SYNTA1', false, now())`,
    [R.multiTab, COHORT, `syncconflict-multi-${run}`],
  );
  // A respondent who has already submitted — answers are immutable (PR5). Typing
  // in a fresh tab must hit a 409 and surface the text read-only.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at, submitted_at)
     values ($1, $2, 'Locked Person', $3, 'SYNTLK', false, now(), now())`,
    [R.locked, COHORT, `syncconflict-locked-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Facilitator', $3, 'SYNTFA', true)`,
    [FACILITATOR, COHORT, `syncconflict-fac-${run}`],
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

/** Read one respondent's q1 answer rows as the cohort facilitator (bypass RLS). */
async function readQ1(
  respondentId: string,
): Promise<{ value: unknown } | null> {
  let row: { value: unknown } | null = null;
  await withRespondentContext(db!, FACILITATOR, async (tx) => {
    const res = await tx.query(
      "select value from answers where respondent_id = $1 and question_id = 'q1'",
      [respondentId],
    );
    row = res.rows[0] ? { value: res.rows[0].value } : null;
  });
  return row;
}

test("two tabs editing the same question converge without data loss", async ({
  page,
}) => {
  await setSession(page, R.multiTab);
  await page.goto("/q/1");

  // Tab A types and saves its answer.
  const textareaA = page.locator("textarea");
  await textareaA.fill(ANSWER_A);
  await expect(page.getByTestId("save-status")).toHaveText("✓ Saved", {
    timeout: 10_000,
  });

  // Tab B — same respondent, same context (shares the session cookie).
  const tabB = await page.context().newPage();
  await tabB.goto("/q/1");
  const textareaB = tabB.locator("textarea");
  await textareaB.fill(ANSWER_B);
  await expect(tabB.getByTestId("save-status")).toHaveText("✓ Saved", {
    timeout: 10_000,
  });

  // The server converged to a single coherent value — the last write wins — and
  // there is exactly one row, so the sync never corrupted the question.
  await expect
    .poll(async () => JSON.stringify((await readQ1(R.multiTab))?.value ?? null), {
      timeout: 10_000,
    })
    .toBe(JSON.stringify({ text: ANSWER_B }));

  // Neither tab lost its local content: each still shows what it typed (local
  // wins on content — a server fetch never overwrote a live field), and no
  // data-loss surface appeared in either tab.
  await expect(textareaA).toHaveValue(ANSWER_A);
  await expect(textareaB).toHaveValue(ANSWER_B);
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Not saved");
  await expect(tabB.locator('[data-slot="save"]')).not.toContainText("Not saved");
  await tabB.close();
});

test("submitting in tab A and typing in tab B surfaces tab B's text read-only", async ({
  page,
}) => {
  // The respondent has already submitted (the fixture sets submitted_at).
  await setSession(page, R.locked);
  await page.goto("/q/1");

  const textarea = page.locator("textarea");
  await textarea.fill(LOCKED_TYPED);

  // The field still holds the typed text — nothing was wiped.
  await expect(textarea).toHaveValue(LOCKED_TYPED);

  // Server wins on lock status: the save slot states the lock, not a retry.
  await expect(page.getByTestId("save-status")).toHaveText("Locked", {
    timeout: 10_000,
  });

  // The unsaved text is surfaced read-only — it is not silently discarded, and
  // it is not framed as an error/a retry.
  await expect(page.getByTestId("lock-conflict")).toBeVisible();
  await expect(page.getByTestId("lock-conflict-text")).toContainText(LOCKED_TYPED);
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Not saved");
  await expect(page.locator('[data-slot="save"]')).not.toContainText("Failed");

  // And it really was rejected: the server holds nothing for q1 for this
  // respondent (the row was never written, not overwritten).
  await expect
    .poll(async () => (await readQ1(R.locked))?.value ?? null, { timeout: 10_000 })
    .toBeNull();
});