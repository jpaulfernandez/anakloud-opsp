import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F15-T02 end to end: source cards on the official OPSP canvas against a real
// Postgres, on the same opt-in as the other DB-gated e2e specs (SKIP unless
// DATABASE_URL and SESSION_SECRET are present). Covers the ticket's three
// acceptances in the rendered UI:
//
//   1. q14d never appears in the picker.
//   2. Removing a source card leaves the answer untouched.
//   3. Attribution is visible on each card.
//
// Each test is self-contained (opens the canvas, attaches, and asserts within
// its own session), so it stays correct under fullyParallel.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

// A per-file randomly generated cohort so fullyParallel workers never collide
// on cohorts_pkey (each worker gets its own fresh id, like the other DB specs).
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const ANA = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Source Cards', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator reaches the canvas (F09-T01).
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', 'lia@example.com', $3, 'SCF1', true, now())`,
    [FACILITATOR, COHORT, `sc-fac-${COHORT}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Ana Reyes', 'ana@example.com', $3, 'SCA1', false)`,
    [ANA, COHORT, `sc-ana-${COHORT}`],
  );

  // A public q7 answer plus the private q14 note for the same respondent. The
  // note must never surface in the picker, while the q7 answer must.
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q7', $3::jsonb, false, null)`,
    [randomUUID(), ANA, JSON.stringify({ text: "Brand clarity above all" })],
  );
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q14d', $3::jsonb, true, null)`,
    [randomUUID(), ANA, JSON.stringify({ private_note: "I might step back in April." })],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

// Each test must observe a clean canvas regardless of worker distribution:
// a worker may run several tests of this file serially (sharing COHORT) or one
// test under fullyParallel (its own COHORT). Clearing the official draft before
// every test keeps the source-card indexes deterministic either way.
test.beforeEach(async () => {
  if (enabled && db) {
    await db
      .query("delete from opsp_drafts where owner_type = 'official' and cohort_id = $1", [COHORT])
      .catch(() => {});
  }
});

async function setSession(page: Page, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

test("the picker lists a respondent's public answer and never the q14d note", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/official-opsp");

  await page.getByTestId("opsp-add-source-bhag").click();

  const picker = page.getByTestId("opsp-source-picker-bhag");
  await expect(picker).toBeVisible();

  // The one public answer (Ana's q7) appears, attributed.
  await expect(page.getByTestId("opsp-source-candidate-0")).toContainText(
    "Brand clarity above all",
  );
  await expect(page.getByTestId("opsp-source-candidate-0")).toContainText("Ana Reyes");

  // The private q14d note is structurally absent from the picker pool.
  await expect(picker).not.toContainText("I might step back in April.");
});

test("attaching an answer shows an attributed card under the cell", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/official-opsp");

  await page.getByTestId("opsp-add-source-bhag").click();
  await page.getByTestId("opsp-source-candidate-0").click();

  // The picking card closes and the attributed card appears under the cell.
  await expect(page.getByTestId("opsp-source-picker-bhag")).toHaveCount(0);
  const card = page.getByTestId("opsp-source-card-bhag-0");
  await expect(card).toBeVisible();
  // Attribution (the respondent's name) is visible on the card.
  await expect(page.getByTestId("opsp-source-attribution-bhag-0")).toHaveText(
    "Ana Reyes · Q7",
  );
  await expect(card).toContainText("Brand clarity above all");
});

test("removing a card leaves the underlying answer untouched", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/official-opsp");

  await page.getByTestId("opsp-add-source-bhag").click();
  await page.getByTestId("opsp-source-candidate-0").click();
  await expect(page.getByTestId("opsp-source-card-bhag-0")).toBeVisible();

  await page.getByTestId("opsp-source-remove-bhag-0").click();
  await expect(page.getByTestId("opsp-source-card-bhag-0")).toHaveCount(0);

  // The answers table row is unchanged after the card was removed.
  const { rows } = await db!.query<{ value: unknown }>(
    `select value from answers where respondent_id = $1 and question_id = 'q7'`,
    [ANA],
  );
  expect(rows[0].value).toEqual({ text: "Brand clarity above all" });
});