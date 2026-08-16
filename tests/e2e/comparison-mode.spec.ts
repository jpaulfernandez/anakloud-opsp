import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F10-T04 end to end: the anonymised ⇄ attributed modes on the admin
// comparison screen, against a real Postgres on the same opt-in as the other
// DB-gated e2e specs (SKIP unless DATABASE_URL and SESSION_SECRET are
// present). Covers the ticket's three acceptances plus the hard "not via URL
// alone" SHALL NOT:
//
//   1. Two loads of the same question in anonymised mode show different card
//      orders — order re-randomises on every load, so it cannot infer identity
//      across sessions (ui_ux.md §4.18).
//   2. Attributed mode is unreachable without passing the confirmation — the
//      mode never changes from a single click, and a URL parameter alone does
//      not enter it either.
//   3. Reloading from attributed mode returns to anonymised — the mode lives
//      in component state only, so a page reload drops straight back.
//
// Six respondents answer Q1 so the anonymised order has 720 possible shuffles
// and two draws collide with negligible probability. The pure shuffle itself
// is covered unit-side (tests/unit/comparison-screen.test.ts); this file is
// the rendered behaviour.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

// A per-file random cohort so fullyParallel workers never collide (see the
// other DB specs and the db-e2e-parallelism note).
const COHORT = randomUUID();
const FACILITATOR = randomUUID();

const MEMBERS = [
  { id: randomUUID(), name: "Alfonso Cruz", code: "CMA1", q1: "Parents wait months to find out whether their child is delayed." },
  { id: randomUUID(), name: "Bianca Delgado", code: "CMB2", q1: "Therapy notes live in six separate notebooks nobody can read quickly." },
  { id: randomUUID(), name: "Carol Tan", code: "CMC3", q1: "A mother travels four hours each way because the only clinic is in Manila." },
  { id: randomUUID(), name: "Dante Reyes", code: "CMD4", q1: "We cut two hours of admin per therapist a week by keeping one record." },
  { id: randomUUID(), name: "Elena Manso", code: "CME5", q1: "Children miss the early-intervention window because screening is too slow." },
  { id: randomUUID(), name: "Federico Lim", code: "CMF6", q1: "Families pay for months of therapy without ever seeing whether it works." },
] as const;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Comparison Modes', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', $3, 'CMMOD0', true, now())`,
    [FACILITATOR, COHORT, `cmp-mode-fac-${COHORT}`],
  );
  for (const m of MEMBERS) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, false)`,
      [m.id, COHORT, m.name, `cmp-mode-${COHORT}-${m.code}`, m.code],
    );
    await withRespondentContext(db!, m.id, (tx) =>
      upsertAnswer(tx, { respondent_id: m.id, question_id: "q1", value: { text: m.q1 } }),
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
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

/** The anonymised card order as a single joined string, for comparison. */
async function readOrder(page: Page): Promise<string> {
  const texts = await page.getByTestId("answer-text").allTextContents();
  return texts.join("|");
}

/** Land on q1 in anonymised mode and let the post-hydration shuffle settle. */
async function gotoQ1(page: Page) {
  await page.goto("/admin/question/q1");
  // The anonymised shuffle runs in an effect after hydration; give it a beat
  // so the read below sees the per-load order rather than the SSR order.
  await page.waitForTimeout(250);
  await expect(page.getByTestId("comparison-grid")).toBeVisible();
}

test("anonymised mode shows a different card order on each load", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await gotoQ1(page);
  const first = await readOrder(page);
  expect(first.split("|")).toHaveLength(MEMBERS.length);

  // Re-randomisation is per-load; reload until the order differs (each draw
  // is independent, so across six reloads a constant order is impossible if
  // shuffling works, and a broken shuffle fails here deterministically).
  let sawDifference = false;
  for (let attempt = 0; attempt < 6 && !sawDifference; attempt++) {
    await page.reload();
    await page.waitForTimeout(250);
    if ((await readOrder(page)) !== first) sawDifference = true;
  }
  expect(sawDifference).toBe(true);
});

test("anonymised mode shows no names", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await gotoQ1(page);

  await expect(page.getByTestId("mode-anonymised")).toHaveAttribute(
    "data-active",
    "true",
  );
  // No card carries an attributed name header in anonymised mode.
  await expect(page.getByTestId("answer-name")).toHaveCount(0);
  // A real name is absent from the page.
  await expect(page.getByText(MEMBERS[0].name)).toHaveCount(0);
});

test("attributed mode is unreachable without passing the confirmation", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await gotoQ1(page);

  // A single click on the attributed toggle only opens the confirmation; the
  // mode does not change.
  await page.getByTestId("mode-attributed").click();
  await expect(page.getByTestId("attributed-confirm")).toBeVisible();
  await expect(page.getByTestId("attributed-confirm-message")).toHaveText(
    "This shows names. Don't use this while projecting.",
  );

  // Declining leaves us firmly in anonymised mode with no names shown.
  await page.getByTestId("attributed-confirm-no").click();
  await expect(page.getByTestId("attributed-confirm")).toHaveCount(0);
  await expect(page.getByTestId("mode-anonymised")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("answer-name")).toHaveCount(0);
  await expect(page.getByText(MEMBERS[1].name)).toHaveCount(0);
});

test("attributed mode is not entered from a URL parameter alone", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q1?mode=attributed");
  await page.waitForTimeout(250);

  // The client ignores the query value; the screen stays anonymised.
  await expect(page.getByTestId("mode-anonymised")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("answer-name")).toHaveCount(0);
  await expect(page.getByText(MEMBERS[0].name)).toHaveCount(0);
});

test("reload from attributed mode returns to anonymised", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await gotoQ1(page);

  // Pass the confirmation to reach attributed mode — the deliberate act.
  await page.getByTestId("mode-attributed").click();
  await expect(page.getByTestId("attributed-confirm")).toBeVisible();
  await page.getByTestId("attributed-confirm-yes").click();

  // Now the attributed payload is loaded and each card names its respondent.
  await expect(page.getByTestId("mode-attributed")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("answer-name")).toHaveCount(MEMBERS.length);
  await expect(page.getByText(MEMBERS[0].name)).toHaveCount(1);

  // A reload has no memory of the mode: it lands back on anonymised, with the
  // names gone and the anonymised toggle active.
  await page.reload();
  await expect(page.getByTestId("mode-anonymised")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByTestId("answer-name")).toHaveCount(0);
  await expect(page.getByText(MEMBERS[0].name)).toHaveCount(0);
});