import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import { OPSP_CELL_IDS, buildOpspCells, type OpspSourceAnswers } from "../../lib/opsp";
import { isOpspCellEmpty } from "../../lib/opsp-view";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F07-T02 end to end: the individual OPSP view and its draft label, against a
// real Postgres (ui_ux.md §4.14). Covering the ticket's three acceptance
// criteria:
//
//   1. The draft label is the first thing rendered and is present on every
//      load — the "Your draft. Not the company's plan." header renders with
//      its supporting line and survives a reload.
//   2. Grid at desktop, stacked cards at 360px, same content — a wide viewport
//      renders a multi-column OPSP grid, a 360px viewport renders a single
//      column, and both show the same cell data.
//   3. Provenance line renders for every non-empty cell — every derived cell
//      carries its "from Q3, Q4" line.
//
// This spec seeds a respondent with the full seeded answer set (SEED_RESPONDENTS
// [0]), runs real submit (F06-T03) so every one of the sixteen cells derives to
// non-empty content, and verifies the view reads the resulting draft. It SKIPS
// unless DATABASE_URL and SESSION_SECRET are present, the same opt-in as the
// other DB-gated e2e specs.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, 'E2E OPSP View', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Planner One', $3, 'OP1', false, now())
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, `opsp-view-${run}`],
  );

  // Seed the full answer set, then run real submit so the draft is created
  // with every one of the sixteen cells deriving to non-empty content.
  await withRespondentContext(db!, RESPONDENT, async (tx) => {
    for (const a of SEED_RESPONDENTS[0].answers) {
      await upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: a.question_id,
        value: a.value,
        confidence: a.confidence ?? null,
      });
    }
  });
  await performSubmit(db!, RESPONDENT, COHORT);
});

test.afterAll(async () => {
  if (!db) return;
  // Delete in dependency order: this respondent's submit created answers,
  // an answer_snapshots row and an opsp_drafts row that all reference it, so
  // a plain `delete from respondents` would trip the FK constraints and (if we
  // swallowed that) silently leak rows into the shared e2e database. Cleaning
  // children first keeps the spec self-cleaning across runs.
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
  await db.query("delete from opsp_drafts where owner_type = 'individual' and owner_id = any($1::uuid[])", [ids]);
  await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
  await db.query("delete from respondents where cohort_id = $1", [COHORT]);
  await db.query("delete from cohorts where id = $1", [COHORT]);
});

async function setSession(page: Page) {
  const token = createSessionToken({ respondentId: RESPONDENT, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

async function gridColumns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="opsp-grid"]');
    if (!el) return 0;
    return getComputedStyle(el)
      .gridTemplateColumns.split(" ")
      .filter((s) => s.trim() !== "").length;
  });
}

/** Build the mapping's view of the seeded answers, as the draft will hold it. */
function seededCells() {
  const snapshot: OpspSourceAnswers = {};
  for (const a of SEED_RESPONDENTS[0].answers) {
    snapshot[a.question_id] = { value: a.value, confidence: a.confidence ?? null };
  }
  return buildOpspCells(snapshot);
}

test("the draft label is the first thing rendered and present on every load", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/opsp");

  // The unmissable label (FR-23) and its ui_ux §4.14 supporting line.
  await expect(page.getByTestId("opsp-draft-label")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your draft. Not the company's plan." }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "This is what your answers add up to. Everyone gets a different one. We'll build the real one together.",
    ),
  ).toBeVisible();

  // The label sits above the grid content: it is the first element in the page.
  const labelBox = await page.getByTestId("opsp-draft-label").boundingBox();
  const gridBox = await page.getByTestId("opsp-grid").boundingBox();
  expect(labelBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect((gridBox as { y: number }).y).toBeGreaterThan((labelBox as { y: number }).y);

  // Present on every load — a reload keeps it.
  await page.reload();
  await expect(page.getByTestId("opsp-draft-label")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your draft. Not the company's plan." }),
  ).toBeVisible();
});

test("desktop renders the OPSP as a grid in columns", async ({ page }) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");

  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  expect(await gridColumns(page)).toBeGreaterThan(1);
});

test("360px renders vertically stacked cards with the same content", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/opsp");

  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  expect(await gridColumns(page)).toBe(1);

  // Same content as the desktop view: this Purpose cell's provenance and the
  // content itself are still rendered in the stacked layout.
  await expect(page.getByTestId("opsp-provenance-purpose")).toBeVisible();
  await expect(page.getByTestId("opsp-provenance-purpose")).toContainText(
    "from Q1, Q2",
  );
  await expect(page.getByTestId("opsp-content-purpose")).toContainText(
    "The people who would miss it most are",
  );
});

test("every non-empty cell shows a provenance line naming its sources", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/opsp");

  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Derive which cells the seeded answers produce as non-empty from the same
  // pure mapping the draft was built from (F07-T01), then assert the view
  // renders exactly those cells with content and a provenance line — and
  // leaves the empty cells empty with no provenance (never auto-filled).
  const cells = seededCells();
  for (const id of OPSP_CELL_IDS) {
    const empty = isOpspCellEmpty(cells[id]);
    if (empty) {
      await expect(page.getByTestId(`opsp-content-${id}`)).toBeEmpty();
      await expect(page.getByTestId(`opsp-provenance-${id}`)).toHaveCount(0);
    } else {
      await expect(page.getByTestId(`opsp-provenance-${id}`)).toBeVisible();
      await expect(page.getByTestId(`opsp-provenance-${id}`)).toContainText("from Q");
      await expect(page.getByTestId(`opsp-content-${id}`)).not.toBeEmpty();
    }
  }
});