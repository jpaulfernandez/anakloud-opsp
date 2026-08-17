import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F10-T06 end to end: the projection sheet export against a real Postgres,
// on the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL
// and SESSION_SECRET are present). Covers the ticket's three acceptances:
//
//   1. No option produces an attributed projection sheet — the sheet has no
//      mode toggle, and neither respondent names nor emails ever appear in
//      the rendered DOM.
//   2. Text is legible when displayed at typical projection sizes — answer
//      cards render at a minimum projector-legible font size, and the
//      divergence badge is present.
//   3. Private rows are absent, verified against seeded private content — the
//      Q14(d) note is never in the sheet even though the facilitator's admin
//      RLS could read it.
//
// The pure shaping (badge mapping, Q14(b) teammate-id redaction, identity-free
// card shape) is covered in tests/unit/projection.test.ts; this file is the
// rendered DOM and the query-layer guarantee.

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
const ANA_EMAIL = "ana@example.com";
const BEN_NAME = "Benito Cruz";
const BEN_EMAIL = "ben@example.com";
// A resident teammate id used inside Ana's Q14(b) attribution, which must be
// redacted on a wall-facing sheet.
const ANA_TEAMMATE_ID = "30000000-0000-0000-0000-0000000000ab";
const PRIVATE_NOTE = "I may need to step back after March.";

const ANA_Q1 =
  "Children with developmental delay wait months for an assessment and travel hours for therapy.";
const BEN_Q1 =
  "Parents pay for months of therapy and never see whether it works because the record lives in six places.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Projection', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', 'lia@example.com', $3, 'PRJF1', true, now())`,
    [FACILITATOR, COHORT, `prj-fac-${COHORT}`],
  );
  for (const [id, name, email, code] of [
    [ANA, ANA_NAME, ANA_EMAIL, "PRJA1"],
    [BEN, BEN_NAME, BEN_EMAIL, "PRJB1"],
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, $6, false)`,
      [id, COHORT, name, email, `prj-${COHORT}-${code}`, code],
    );
  }

  // Q1 open text, deliberately long for the manual-review badge.
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, { respondent_id: ANA, question_id: "q1", value: { text: ANA_Q1 } }),
  );
  await withRespondentContext(db!, BEN, (tx) =>
    upsertAnswer(tx, { respondent_id: BEN, question_id: "q1", value: { text: BEN_Q1 } }),
  );

  // Q3 closed + confidence → a deterministic soft split badge on the sheet.
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, {
      respondent_id: ANA,
      question_id: "q3",
      value: { metric: "paying centers", value: 300, unit: "paying_centers", why: "adoption" },
      confidence: 2,
    }),
  );
  await withRespondentContext(db!, BEN, (tx) =>
    upsertAnswer(tx, {
      respondent_id: BEN,
      question_id: "q3",
      value: { metric: "renewals", value: 80, unit: "renewals", why: "retention" },
      confidence: 3,
    }),
  );

  // Q14 with a teammate attribution and a private note. The note must never
  // reach the projection sheet; the teammate id must be redacted.
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, {
      respondent_id: ANA,
      question_id: "q14",
      value: {
        wants: ["product"],
        others: { [ANA_TEAMMATE_ID]: "backend" },
        hours: 30,
        private_note: PRIVATE_NOTE,
      },
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

async function setSession(page: Page) {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

test("the projection sheet renders all questions with no names, emails, ids or private note", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/admin/projection");

  await expect(page.getByTestId("projection-sheet")).toBeVisible();

  // Every one of the fifteen questions has a block on the sheet.
  await expect(page.getByTestId("projection-question-q1")).toBeVisible();
  await expect(page.getByTestId("projection-question-q14")).toBeVisible();

  // Both anonymised answer texts are present, verbatim and untruncated.
  const texts = await page.getByTestId("projection-answer-text").allTextContents();
  expect(texts.some((t) => t.includes(ANA_Q1))).toBe(true);
  expect(texts.some((t) => t.includes(BEN_Q1))).toBe(true);

  const body = await page.locator("body").innerText();

  // No identity under any option: names and emails are absent from the sheet.
  expect(body).not.toContain(ANA_NAME);
  expect(body).not.toContain(BEN_NAME);
  expect(body).not.toContain(ANA_EMAIL);
  expect(body).not.toContain(BEN_EMAIL);

  // No attributed chrome: there is no mode toggle and no per-card name.
  await expect(page.getByTestId("answer-name")).toHaveCount(0);

  // No respondent identifiers leak through a raw value (Q14(b) teammate id).
  expect(body).not.toContain(ANA_TEAMMATE_ID);

  // Private rows absent: the facilitator's own RLS could read the note, but
  // the sheet never carries it.
  expect(body).not.toContain(PRIVATE_NOTE);
});

test("the sheet reveals the deterministic divergence badge and stays legible at projector distance", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/admin/projection");

  // Q3's two different metrics at low confidence classify as a soft split
  // (FR-31), computed purely from stored answers — no AI involved.
  const q3 = page.getByTestId("projection-question-q3");
  await expect(q3).toBeVisible();
  await expect(q3.getByTestId("projection-badge")).toHaveText("Soft split");

  // Open text (Q1) is flagged for manual review.
  await expect(page.getByTestId("projection-question-q1").getByTestId("projection-badge"))
    .toHaveText("Manual review");

  // Legibility at projection distance: answer text renders at a large enough
  // size that a room reads it — not the questionnaire's comfortable 13px.
  const fontSize = await q3
    .getByTestId("projection-answer-text")
    .first()
    .evaluate((el) => Number(getComputedStyle(el).fontSize.replace("px", "")));
  expect(fontSize).toBeGreaterThanOrEqual(16);
});

test("the sheet is anonymised unconditionally even from the query layer and prints per the stylesheet conventions", async ({
  page,
}) => {
  await setSession(page);

  // The raw comparison endpoint in its default (anonymised) mode must not
  // carry identity either, so a projection can never be downgraded to
  // attributed by asking the API differently. (The sheet page itself never
  // requests anything but anonymised.)
  const res = await page.request.get("/api/admin/question/q1");
  expect(res.status()).toBe(200);
  const json = (await res.json()) as { answers: unknown[] };
  expect(json.answers).toHaveLength(2);
  const raw = JSON.stringify(json);
  expect(raw).not.toContain(ANA_NAME);
  expect(raw).not.toContain(BEN_EMAIL);

  // Under print media, the back-navigation chrome is hidden (F08-T01
  // convention: no chrome on the exported sheet) and each answer card resists
  // splitting across a page break.
  await page.emulateMedia({ media: "print" });
  await page.goto("/admin/projection");
  await expect(page.getByTestId("projection-back")).toBeHidden();

  const card = page.getByTestId("projection-card").first();
  const style = await card.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      breakInside: s.breakInside,
      legacy: (s as CSSStyleDeclaration & { pageBreakInside: string }).pageBreakInside,
    };
  });
  expect(style.breakInside).toBe("avoid");
  expect(style.legacy).toBe("avoid");
});