import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F11-T02 — the T2 key-removal end-to-end test (the P1 gate).
//
// This is PR3's real test: delete ANTHROPIC_API_KEY from the environment and
// drive a genuine respondent through the whole product — claim an invite,
// enter a name, accept the ground rules, answer all fifteen questions in the
// browser, review, submit through the actual UI button, view the OPSP, export
// a PDF, then open the admin comparison and download the CSV as the
// facilitator. Every step must pass, and no respondent-visible error, banner
// or spinner may appear anywhere in the journey. It is the gate on P1: nothing
// in P2 begins until this is green.
//
// The whole journey is ONE test so the spec never splits across Playwright
// workers (fullyParallel would otherwise re-run beforeAll per worker and
// collide on the fixed cohort id); it runs against a real Postgres — like the
// other DB-gated e2e specs, it SKIPS unless DATABASE_URL and SESSION_SECRET
// are present. Run it with the key removed:
//
//   env -u ANTHROPIC_API_KEY npx playwright test --reporter=line

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();
const FACILITATOR = randomUUID();

const RESPONDENT_NAME = "Juan Dela Cruz";
const INVITE_TOKEN = `key-removal-${run}`;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  // on conflict do nothing makes the setup idempotent across a Playwright
  // retry of the single journey test (the consts are module-scoped).
  await db.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, 'E2E Key Removal', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  // An already-submitted facilitator (FR-28) so the admin view is unlocked for
  // the comparison and CSV legs of the journey.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        submitted_at, ground_rules_acknowledged_at)
     values ($1, $2, 'Lia Mendoza', $3, 'KFAC2', true, now(), now())
     on conflict (id) do nothing`,
    [FACILITATOR, COHORT, `key-removal-fac-${run}`],
  );
  // A fresh respondent with a blank display name: claiming the invite must land
  // on /welcome (claimLanding treats a blank name as name entry pending), which
  // is the start of the real respondent journey.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, '', $3, 'KRSP1', false)
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, INVITE_TOKEN],
  );
});

test.afterAll(async () => {
  if (!db) return;
  // Delete in dependency order (the respondent's journey writes answers, an
  // answer_snapshots row, an opsp_drafts row, and possibly ai_interactions), so
  // a fall-through delete would trip the FK constraints and leak rows.
  const { rows } = await db.query<{ id: string }>(
    "select id from respondents where cohort_id = $1",
    [COHORT],
  );
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) {
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    return;
  }
  await db.query("delete from ai_interactions where respondent_id = any($1::uuid[])", [ids]);
  await db.query("delete from answer_snapshots where respondent_id = any($1::uuid[])", [ids]);
  await db.query(
    "delete from opsp_drafts where owner_type = 'individual' and owner_id = any($1::uuid[])",
    [ids],
  );
  await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
  await db.query("delete from respondents where cohort_id = $1", [COHORT]);
  await db.query("delete from cohorts where id = $1", [COHORT]);
  await db.end();
});

/** The Q1 answer: comfortably over the 200-character minimum while reading
    like a real response. */
const Q1_TEXT =
  "A parent takes their child to three therapists and none of them talk to " +
  "each other. Every session's notes stay in a paper ledger that no one but the " +
  "therapist who wrote them can read, so nobody — not the family, not the clinic, " +
  "not the health system — can see whether early help is actually working, and " +
  "the same assessment gets repeated by hand on every single visit.";

const Q15_TEXT =
  "Maya stayed late one night to catch a typo in the beta onboarding so the " +
  "first six users would not see it, and she did not wait to be asked.";

// The six FR-11 confidence questions must each carry a ring before Continue.
async function setConfidence(page: Page): Promise<void> {
  await page.getByLabel("Confidence (number)").fill("4");
}

/** Click Continue on q1..q14 and wait for the next question to load. */
async function advance(page: Page, toUrl: RegExp): Promise<void> {
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(toUrl);
}

/** No red error text on the current page. The role="alert" check is handled
    by the MutationObserver recorder, which is timing-independent and reports
    the offending markup in the end-of-journey assertion. */
async function expectClean(page: Page): Promise<void> {
  await expect(page.locator('[class*="text-red"]')).toHaveCount(0);
}

test(
  "the full journey passes with no AI key present",
  async ({ page, browser }) => {
    test.setTimeout(180_000);

    // Stub window.print for the PDF leg, and record every role="alert" element
    // that ever appears in the respondent's pages (transient ones included), so
    // the end-of-journey cleanliness assertion is not a timing fluke.
    await page.context().addInitScript(() => {
      const w = window as unknown as {
        __printCalls: number;
        print: () => void;
        __alerts: string[];
      };
      w.__printCalls = 0;
      w.__alerts = [];
      w.print = () => {
        w.__printCalls += 1;
      };
      const record = (el: Element) => {
        w.__alerts.push((el as HTMLElement).outerHTML.slice(0, 600));
      };
      new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "childList") {
            r.addedNodes.forEach((node) => {
              if (
                node instanceof Element &&
                node.getAttribute("role") === "alert"
              ) {
                record(node);
              }
            });
          } else if (r.type === "attributes" && r.attributeName === "role") {
            const el = r.target as Element;
            if (el.getAttribute("role") === "alert") record(el);
          }
        }
      }).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["role"],
      });
    });

    // ── 1. Claim the invite. ──────────────────────────────────────────────
    await page.goto(`/claim?token=${INVITE_TOKEN}`);
    await expect(page).toHaveURL(/\/welcome$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Before we start." })).toBeVisible();

    // ── 2. Welcome name entry. ────────────────────────────────────────────
    await page.getByLabel("Your name").fill(RESPONDENT_NAME);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/ground-rules$/);

    // ── 3. Ground rules. ──────────────────────────────────────────────────
    await page.getByLabel("Got it").check();
    await page.getByRole("button", { name: "Continue" }).click();
    // Lands on the resume landing ("/"), whose Continue leads to the first
    // unanswered question (Q1 for a fresh respondent).
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Continue" })).toBeVisible();
    await page.getByRole("link", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/q\/1$/);

    // ── 4. Answer all fifteen questions. ──────────────────────────────────

    // Q1 long text.
    await page.getByLabel("Your answer").fill(Q1_TEXT);
    await advance(page, /\/q\/2$/);

    // Q2 sentence completion (scope to the inline presentation; the stacked
    // mobile variant is also in the DOM but hidden on a wide viewport).
    const sentenceInline = page.getByTestId("q2-sentence-inline");
    await sentenceInline
      .getByLabel("The people who would miss it most are")
      .fill("the therapists");
    await sentenceInline.getByLabel("because").fill("their notes live on paper");
    await advance(page, /\/q\/3$/);

    // Q3 metric triple + confidence ("Number" exact — the confidence field's
    // "Confidence (number)" would otherwise be caught by substring matching).
    await page.getByLabel("What would you count?").fill("centers onboarded");
    await page.getByLabel("Number", { exact: true }).fill("40");
    await page.getByLabel("Unit").fill("per year");
    await page.getByLabel("Why that one?").fill("that is the number that shows scale");
    await setConfidence(page);
    await advance(page, /\/q\/4$/);

    // Q4 BHAG (short text, one sentence) + confidence.
    await page.getByLabel("Your answer").fill("Every PH child with a delay gets early help.");
    await setConfidence(page);
    await advance(page, /\/q\/5$/);

    // Q5 matrix grid — any cell makes it an answer.
    await page.getByLabel("Parent or guardian — Pays us").check();
    await advance(page, /\/q\/6$/);

    // Q6 tiebreak + required reason (≥8 words, not a restatement).
    await page.getByRole("radio", { name: "Center" }).check();
    await page.getByLabel("One line: why").fill(
      "They have the budget and the daily workflow that fits our product best.",
    );
    await advance(page, /\/q\/7$/);

    // Q7 one-line promise (≤120, ≤1 conjunction) + confidence.
    await page.getByLabel("Your answer").fill("the only system built for PH clinics");
    await setConfidence(page);
    await advance(page, /\/q\/8$/);

    // Q8 tap-to-assign ranking: a full order, a delete choice, a why, and a
    // full predicted order, then confidence.
    const pool = page.getByTestId("rank-pool");
    for (const app of ["PedConnect", "TeachDay", "ParentUp", "Fourth app"]) {
      await pool.getByRole("button", { name: app }).click();
    }
    await expect(page.getByTestId("rank-ordered").getByText("#1")).toBeVisible();
    await page.getByRole("radio", { name: "Fourth app" }).check();
    await page.getByLabel("One line why").fill("lowest pull on the door to a yes");
    await page
      .getByRole("button", { name: "What do you think the group's #1 will be?" })
      .click();
    const predicted = page.getByTestId("predicted-pool");
    for (const app of ["PedConnect", "TeachDay", "ParentUp", "Fourth app"]) {
      await predicted.getByRole("button", { name: app }).click();
    }
    await setConfidence(page);
    await advance(page, /\/q\/9$/);

    // Q9 three not-doing lines, each ≥4 words.
    await page.getByLabel("Not doing 1").fill("no HR recruitment tooling");
    await page.getByLabel("Not doing 2").fill("no billing or payments");
    await page.getByLabel("Not doing 3").fill("no consumer app store");
    await advance(page, /\/q\/10$/);

    // Q10 how the money works + confidence.
    await page.getByRole("radio", { name: "parent", exact: true }).check();
    await page.getByRole("radio", { name: "per active child per month" }).check();
    await page.getByLabel("What do they pay, in pesos?").fill("499");
    await page.getByLabel("What month does the first real peso arrive?").fill("2026-11");
    await setConfidence(page);
    await advance(page, /\/q\/11$/);

    // Q11 paired rows + star: block one's done-condition is verifiable + confidence.
    await page.getByLabel("What").first().fill("ship the beta");
    await page.getByLabel("Done when").first().fill("30 Sept");
    await setConfidence(page);
    await advance(page, /\/q\/12$/);

    // Q12 name the quarter.
    await page.getByLabel("Your answer").fill("Prove the door opens");
    await advance(page, /\/q\/13$/);

    // Q13 pre-mortem: text plus the most-likely cause.
    await page.getByLabel("Your explanation").fill("We ran out of money and never picked one thing to bet on.");
    await page.getByRole("radio", { name: "ran out of money" }).check();
    await advance(page, /\/q\/14$/);

    // Q14 capped multi-select + hours slider; hours is what makes it an answer.
    await page.getByRole("button", { name: "product", exact: true }).click();
    await page.getByLabel("Hours per week (number)").fill("24");
    await advance(page, /\/q\/15$/);

    // Q15 (optional) — the last screen's button is "Review your answers".
    await page.getByLabel("Your answer").fill(Q15_TEXT);
    await page.getByRole("button", { name: "Review your answers" }).click();
    await expect(page).toHaveURL(/\/review$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review your answers");

    // ── 5. Submit through the real UI. ────────────────────────────────────
    await page.getByTestId("review-submit").click();
    await expect(page.getByTestId("submit-confirmation")).toBeVisible();
    await page.getByTestId("submit-confirm").click();
    // A successful submit sends the respondent to "/" and the submitted view.
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: new RegExp(`You're all set, ${RESPONDENT_NAME}\\.`) }),
    ).toBeVisible();
    await expectClean(page);

    // ── 6. View the OPSP and export a PDF. ────────────────────────────────
    await page.getByRole("link", { name: "View your One-Page Strategic Plan" }).click();
    await expect(page).toHaveURL(/\/opsp$/);
    await expect(page.getByTestId("opsp-draft-label")).toBeVisible();
    await expectClean(page);

    await page.getByTestId("opsp-print-trigger").click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __printCalls: number }).__printCalls),
      )
      .toBe(1);

    // ── 7. Admin comparison and CSV export, as the facilitator. ───────────
    const facilitator = await browser.newContext();
    await facilitator.addCookies([
      {
        name: SESSION_COOKIE,
        value: createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT }),
        domain: "127.0.0.1",
        path: "/",
      },
    ]);
    const admin = await facilitator.newPage();
    await admin.goto("/admin/question/q5");
    // The comparison board renders the respondent's Q5 answer (anonymised). The
    // divergence badge is only shown when scoring yields a category, which a
    // single answer does not, so assert on the grid and its card instead.
    await expect(admin.getByRole("heading", { level: 1, name: "The four roles" })).toBeVisible();
    await expect(admin.getByTestId("comparison-grid")).toBeVisible();
    await expect(admin.getByTestId("answer-card")).toHaveCount(1);
    await expect(admin.getByTestId("answer-text").first()).toContainText(
      "Pays us: Parent or guardian",
    );

    const csv = await facilitator.request.get("/api/admin/export");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const csvBody = await csv.text();
    // The respondent's answers (minus the private field) and name are exported;
    // pick a distinctive string from a non-private answer to prove the export
    // carries the journeyed answers.
    expect(csvBody).toContain(RESPONDENT_NAME);
    expect(csvBody).toContain("Prove the door opens");
    await facilitator.close();

    // ── 8. No respondent-visible error appeared anywhere in the journey. ────
    const surfaced = await page.evaluate(
      () => (window as unknown as { __alerts?: string[] }).__alerts ?? [],
    );
    expect(surfaced, surfaced.join("\n---\n")).toHaveLength(0);
  },
);