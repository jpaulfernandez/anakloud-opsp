import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { STATIC_HINTS } from "../../lib/static-hints";

// F05-T05 end to end: the client coach shell actually writes interaction rows
// over real HTTP. This is the full client → POST /api/interactions →
// ai_interactions path, on the same opt-in as the other DB-backed specs (SKIP
// unless DATABASE_URL and SESSION_SECRET are present).
//
// It proves the two row-level records that live on the interaction path end to
// end:
//   - three nudges on one question produce three rows with attempts 1, 2, 3 at
//     L2, matching the deterministic coach verdict and static hint;
//   - requesting an example flips example_shown on the current nudge's row.
// (The answer_changed flip and the no-answer-text-in-logs property are covered
// at the storage layer in tests/unit/interactions.integration.test.ts — the
// edit path and log capture need no browser.)
//
// Q7 is coachable and carries a static example (F05-T02), so it serves both
// nudge flow and example flow.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();

const Q7_FAILING = "easy and simple and calm for every parent";

/** Q7 is a confidence-bearing question, so Continue needs the ring set too. */
async function setConfidence(page: Page) {
  await page.getByLabel("Confidence (number)").fill("4");
}

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Interactions', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Interaction Person', $3, 'INT2', false, now())`,
    [RESPONDENT, COHORT, `interactions-e2e-${run}`],
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

async function clearLog() {
  await db!.query("delete from ai_interactions where respondent_id = $1", [
    RESPONDENT,
  ]);
}

async function rows() {
  const { rows } = await db!.query(
    `select attempt_no, level, verdict, hint_text, example_shown
       from ai_interactions
      where respondent_id = $1 and question_id = 'q7' and purpose = 'coach'
      order by attempt_no`,
    [RESPONDENT],
  );
  return rows as Array<{
    attempt_no: number;
    level: string;
    verdict: string;
    hint_text: string;
    example_shown: boolean;
  }>;
}

test("three nudges on one question write three rows with attempts 1, 2, 3", async ({
  page,
}) => {
  await setSession(page);
  await clearLog();

  await page.goto("/q/7");
  const card = page.getByTestId("coach-card");
  const revise = () => card.getByRole("button", { name: /Let me revise/ }).click();

  const failAndContinue = async (answer: string) => {
    await page.getByTestId("capped-short-text-input").fill(answer);
    await setConfidence(page);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(card).toBeVisible();
  };

  await failAndContinue(Q7_FAILING);
  await expect(card).toContainText("nudge 1 of 3");
  await revise();
  await failAndContinue("fast and friendly and warm for everyone");
  await expect(card).toContainText("nudge 2 of 3");
  await revise();
  await failAndContinue("quick and neat and kind to every family");
  await expect(card).toContainText("nudge 3 of 3");

  // The nudge logging POSTs are fire-and-forget, so wait for the writes to land
  // before asserting on the rows, rather than racing them.
  await expect.poll(async () => (await rows()).length, { timeout: 5000 }).toBe(3);
  const logged = await rows();
  expect(logged.map((r) => r.attempt_no)).toEqual([1, 2, 3]);
  expect(logged.map((r) => r.level)).toEqual(["L2", "L2", "L2"]);
  expect(logged.every((r) => r.verdict === "needs_work")).toBe(true);
  expect(logged.every((r) => r.hint_text === STATIC_HINTS.q7.hint)).toBe(true);
});

test("requesting an example flips example_shown on the current nudge's row", async ({
  page,
}) => {
  await setSession(page);
  await clearLog();

  await page.goto("/q/7");
  await page.getByTestId("capped-short-text-input").fill(Q7_FAILING);
  await setConfidence(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("coach-card")).toBeVisible();

  // Two nudges: the example is requested against the second one, so only that
  // nudge's row flips.
  await page
    .getByTestId("coach-card")
    .getByRole("button", { name: /Let me revise/ })
    .click();
  await page.getByTestId("capped-short-text-input").fill(
    "fast and friendly and warm for everyone",
  );
  await setConfidence(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByTestId("coach-card")).toContainText("nudge 2 of 3");

  await page
    .getByTestId("coach-card")
    .getByRole("button", { name: /Show me an example/ })
    .click();
  await expect(page.getByTestId("coach-example")).toBeVisible();

  // Wait for both fire-and-forget writes — the nudge row and the example flip —
  // to land before asserting on the rows.
  await expect.poll(async () => (await rows()).length, { timeout: 5000 }).toBe(2);
  await expect
    .poll(async () => (await rows())[1]?.example_shown, { timeout: 5000 })
    .toBe(true);

  const logged = await rows();
  expect(logged).toHaveLength(2);
  expect(logged[0].attempt_no).toBe(1);
  expect(logged[0].example_shown).toBe(false);
  expect(logged[1].attempt_no).toBe(2);
  expect(logged[1].example_shown).toBe(true);
});