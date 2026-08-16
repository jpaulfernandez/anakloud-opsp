import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import type { AnalysisServeBody } from "../../lib/analyse-endpoint";

// F14-T03 end to end — the facilitator-analysis side panel vs a real Postgres
// (SKIP unless DATABASE_URL and SESSION_SECRET are present, like the other
// DB-gated specs). Covers the ticket's four acceptances:
//
//   1. The raw answers stay on screen next to the panel at every viewport
//      width — asserted both at the desktop breakpoint (panel side-by-side)
//      and at a narrow mobile viewport (panel stacked below the board).
//   2. Model name and timestamp are present on every output — exercised over
//      a route-mocked L0 serve (no live model needed under ./verify.sh),
//      asserting the footer label text.
//   3. The L2 deterministic panel is presented as its own feature — a
//      "Divergence scoring" breakdown plus an export button — with no error
//      language, no "unavailable" and no Retry affordance.
//   4. Re-run produces a new labelled output without discarding the previous —
//      the route mock counts calls, so the panel shows two labelled runs.
//
// The spec is serial within the file (one worker, one beforeAll) because the
// DB-gated suites share module-scoped cohorts and must not collide across
// parallel workers.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESP1 = randomUUID();
const RESP2 = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Analysis Panel', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Panel Facilitator', $3, 'PANLF1', true, now())`,
    [FACILITATOR, COHORT, `panel-fac-${COHORT}`],
  );
  for (const id of [RESP1, RESP2]) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, false)`,
      [id, COHORT, `Responder ${id.slice(0, 4)}`, `${id.slice(0, 4)}-tok`, `${id.slice(0, 4)}-code`],
    );
  }

  // Opposite Q8 rankings so the deterministic scoring shows a real split, and
  // so the comparison board has cards to keep on screen.
  const responder = async (id: string, seed: number) => {
    await withRespondentContext(db!, id, async (tx) => {
      await upsertAnswer(tx, {
        respondent_id: id,
        question_id: "q8",
        value: {
          rank:
            seed === 1
              ? ["pedconnect", "teachday", "parentup", "fourth_app"]
              : ["teachday", "pedconnect", "parentup", "fourth_app"],
          delete: "fourth_app",
          why: `reason ${seed}`,
          predicted: ["teachday", "pedconnect", "parentup", "fourth_app"],
        },
        confidence: 5,
      });
    });
  };
  await responder(RESP1, 1);
  await responder(RESP2, 2);
});

test.afterAll(async () => {
  if (db) {
    const { rows } = await db.query<{ id: string }>(
      "select id from respondents where cohort_id = $1",
      [COHORT],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.query("delete from ai_interactions where respondent_id = any($1::uuid[])", [ids]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    await db.query("delete from respondents where cohort_id = $1", [COHORT]);
    await db.query("delete from cohorts where id = $1", [COHORT]);
    await db.end();
  }
});

async function setSession(page: Page, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

async function openPanel(page: Page) {
  await page.getByTestId("open-analysis-panel").click();
  await expect(page.getByTestId("analysis-panel")).toBeVisible();
}

test("the raw answers stay on screen next to the panel at every viewport width", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q8");
  await expect(page.getByTestId("answer-card")).toHaveCount(2);

  await openPanel(page);

  // Desktop: the board and the panel share the row — the answers are still
  // there, not obscured by an overlay.
  await expect(page.getByTestId("answer-card")).toHaveCount(2);
  await expect(page.getByTestId("answer-card").first()).toBeInViewport();

  // Narrow mobile: the panel stacks below the board in the document flow, so
  // the answers remain on screen above it rather than being covered.
  await page.setViewportSize({ width: 375, height: 720 });
  await expect(page.getByTestId("analysis-panel")).toBeVisible();
  await expect(page.getByTestId("answer-card")).toHaveCount(2);
  await expect(page.getByTestId("answer-card").first()).toBeInViewport();
});

test("the L2 panel is the deterministic scoring feature with no error language, no 'unavailable', no retry spinner", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q8");
  await openPanel(page);

  // The deterministic breakdown replaces the panel as its own feature (the
  // dev/L2 default is the key-removal path from F14-T02).
  await expect(page.getByTestId("deterministic-panel")).toBeVisible();
  await expect(page.getByTestId("scoring-title")).toHaveText("Divergence scoring");
  await expect(page.getByTestId("scoring-export-csv")).toBeVisible();
  await expect(page.getByTestId("scoring-export-projection")).toBeVisible();
  // The prepared Q8 split is present as a scoring entry.
  await expect(page.getByTestId("scoring-entry")).toHaveCount(1);
  // The standing prep label is always shown.
  await expect(page.getByTestId("analysis-prep-label")).toHaveText(
    "Prep material. Not a finding to show the team.",
  );

  const panelText = (await page.getByTestId("analysis-panel").innerText()).toLowerCase();
  expect(panelText).not.toContain("unavailable");
  expect(panelText).not.toContain("retry");
  expect(panelText).not.toContain("spinner");
});

test("a served analysis shows the model name and timestamp, and re-run keeps every output", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/question/q8");

  // Route-mock the analyse endpoint to an L0 serve so the panel's labelling
  // and re-run retention are exercised without a live model (keeps this spec
  // inside ./verify.sh). Each call gets a distinct timestamp so re-run's new
  // output is visibly a new, labelled one. The panel's fetch effect can fire
  // twice under dev StrictMode on mount (the first is discarded client-side),
  // so the assertions rely on count and label distinctness rather than on a
  // call counter.
  let call = 0;
  await page.route("**/api/admin/analyse", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    call += 1;
    const body: AnalysisServeBody = {
      ok: true,
      level: "L0",
      scope: "question",
      questionId: "q8",
      analysis: {
        agreement: `agree ${call}`,
        conflicts: [{ between: "A and B", positions: [`position ${call}`] }],
        askInRoom: [`ask ${call}`],
        wordingNote: null,
      },
      label: {
        model: "opencode/sonnet-test",
        generatedAt: new Date(
          Date.parse("2026-08-17T12:34:00.000Z") + call * 60_000,
        ).toISOString(),
      },
    };
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await openPanel(page);
  await expect(page.getByTestId("analysis-read")).toBeVisible();
  await expect(page.getByTestId("analysis-agreement").first()).not.toHaveText("");

  // Every output is labelled with a model name and a timestamp (FR-35).
  const firstLabel = await page
    .getByTestId("analysis-run-label")
    .first()
    .innerText();
  expect(firstLabel).toContain("opencode/sonnet-test");
  expect(firstLabel).toContain("·");
  expect(firstLabel).toContain("UTC");

  // Re-run appends a new labelled output instead of discarding the previous.
  await page.getByTestId("analysis-rerun").click();
  await expect(page.getByTestId("analysis-run")).toHaveCount(2);
  const labels = await page.getByTestId("analysis-run-label").allTextContents();
  expect(labels).toHaveLength(2);
  // Both are labelled, and the two labels are distinct — re-run produced a new
  // output rather than overwriting the previous one.
  expect(new Set(labels).size).toBe(2);
  expect(labels[0]).toContain("opencode/sonnet-test");
  expect(labels[1]).toContain("opencode/sonnet-test");
  const ts = (labelText: string) => labelText.split("·").pop()!.trim();
  expect(ts(labels[0])).not.toBe(ts(labels[1]));
});