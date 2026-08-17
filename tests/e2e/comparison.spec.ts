import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F10-T03 end to end: the admin comparison screen against a real Postgres, on
// the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL
// and SESSION_SECRET are present). Covers the ticket's three acceptances:
//
//   1. The divergence badge is visible with the AI disabled — the verdict is
//      computed deterministically from the stored answers (FR-31), so no AI
//      key is present anywhere in this run and the badge still renders.
//   2. Long answers are readable without opening a modal — the full text is in
//      the DOM with nothing truncating it.
//   3. Cards align to equal height across a row — asserted by bounding box.
//
// The pure screen model (badge label, answer text, anonymised redaction) is
// covered in tests/unit/comparison-screen.test.ts; this file is the rendered
// DOM and geometry.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

// A per-file randomly generated cohort so fullyParallel workers never collide
// on cohorts_pkey (each worker gets its own fresh id, like the other DB specs).
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const ANA = randomUUID();
const BEN = randomUUID();

const ANA_NAME = "Ana Reyes";
const BEN_NAME = "Benito Cruz";

// Three deliberately different answers so the verdict is non-trivial and the
// full text is long enough to matter when it is read on screen.
const ANA_Q1 =
  "Children with developmental delay in the Philippines wait months for an assessment and travel hours for therapy. We exist so that waiting stops being the reason a child misses care.";
const BEN_Q1 =
  "Parents pay for months of therapy and never see whether it works because the record lives in six places. We make progress visible so families know what they are buying.";

/** A deterministic Q3 answer the screen must show in full. */
const META_ANA = "The number of therapy centers actively paying us each month.";
const META_BEN = "How many centers renew their subscription without a discount.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Comparison', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', $3, 'CMPF1', true, now())`,
    [FACILITATOR, COHORT, `cmp-fac-${COHORT}`],
  );
  for (const [id, name, code] of [
    [ANA, ANA_NAME, "CMPA1"],
    [BEN, BEN_NAME, "CMPB1"],
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, false)`,
      [id, COHORT, name, `cmp-${COHORT}-${code}`, code],
    );
  }

  // Q1 open text with long, full-answer prose (manual review badge).
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, { respondent_id: ANA, question_id: "q1", value: { text: ANA_Q1 } }),
  );
  await withRespondentContext(db!, BEN, (tx) =>
    upsertAnswer(tx, { respondent_id: BEN, question_id: "q1", value: { text: BEN_Q1 } }),
  );

  // Q3 closed + confidence. Two different metrics low confidence → soft split.
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, {
      respondent_id: ANA,
      question_id: "q3",
      value: { metric: META_ANA, value: 300, unit: "paying_centers", why: "adoption" },
      confidence: 2,
    }),
  );
  await withRespondentContext(db!, BEN, (tx) =>
    upsertAnswer(tx, {
      respondent_id: BEN,
      question_id: "q3",
      value: { metric: META_BEN, value: 80, unit: "renewals", why: "retention" },
      confidence: 3,
    }),
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
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

test("the divergence badge renders deterministically with no AI involved", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q3");

  // Q3's two different metrics at low confidence classify as a soft split
  // (FR-31), computed purely from the stored answers — no AI key, no network.
  const badge = page.getByTestId("divergence-badge");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("Soft split");
});

test("long answers are readable in full without opening a modal", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q1");

  // The badge for open text is the manual-review flag (FR-31).
  await expect(page.getByTestId("divergence-badge")).toHaveText("Manual review");

  // Both complete answers are present in the DOM, verbatim and untruncated —
  // the whole point of "readable without opening a modal" (F10-T03). Card
  // order is randomised in anonymised mode (F10-T04), so assert membership,
  // never position.
  const texts = await page.getByTestId("answer-text").allTextContents();
  expect(texts).toHaveLength(2);
  expect(texts.some((t) => t.includes(ANA_Q1))).toBe(true);
  expect(texts.some((t) => t.includes(BEN_Q1))).toBe(true);
});

test("cards align to equal height across a row", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q1");

  const cards = page.getByTestId("answer-card");
  await expect(cards).toHaveCount(2);

  // At the lg (3-column) breakpoint two cards sit in the same row; the grid
  // stretches items to the row height, so their bounding heights match.
  const boxes = await cards.evaluateAll((els) => els.map((el) => ({ h: el.getBoundingClientRect().height })));
  expect(boxes[0].h).toBeCloseTo(boxes[1].h, 0);
});

test("each answer's confidence is shown where the question carries one", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q3");

  // Q3 is confidence-bearing (FR-11); each card shows its stored value. Order
  // is randomised (F10-T04), so assert the set of values, not their position.
  const confidences = await page.getByTestId("answer-confidence").allTextContents();
  expect(confidences).toHaveLength(2);
  expect(confidences.some((c) => c.includes("Confidence 2"))).toBe(true);
  expect(confidences.some((c) => c.includes("Confidence 3"))).toBe(true);
});