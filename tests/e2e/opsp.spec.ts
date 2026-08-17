import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import { OPSP_CELL_IDS, buildOpspCells, type OpspSourceAnswers } from "../../lib/opsp";
import { isOpspCellEmpty } from "../../lib/opsp-view";
import {
  OPSP_EMPTY_NOTE,
  OPSP_LOW_CONFIDENCE_NOTE,
  OPSP_REVISIT_TAG,
} from "../../lib/opsp-state";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F07-T02 end to end: the individual OPSP view and its draft label, against a
// real Postgres (ui_ux.md §4.14). Covering two tickets' acceptance criteria:
//
//   F07-T02 — the draft label is the first thing rendered and present on every
//     load; grid at desktop and stacked cards at 360px with identical content;
//     a provenance line for every non-empty cell.
//   F07-T03 — ink/pencil/empty treatment survives greyscale (weight, dashed
//     left border and text tag, never colour); low-confidence and empty cells
//     carry their notes; no cell is auto-filled.
//   F07-T04 — the "How to read this" panel is a persistent right-hand column at
//     desktop and a bottom sheet on mobile, with a static, repository-authored
//     explanation for every cell; tapping a cell scrolls the panel to that
//     cell's explanation on both layouts.
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

// F07-T03 — ink, pencil and empty cells (FR-24, ui_ux.md §2, §4.14, §7). These
// reuse the seeded respondent above, whose derived cells give us every state at
// once: the seed's low-confidence sources (Q4, Q10) make BHAG / profit_per_x /
// year1_critical_number pencil, its full-confidence Part B defaults (Q7) stay
// pencil at full confidence, and its SWT — Threats cell is empty because the
// seed's Q13 carries no `cause` fragment. Purpose is a confident ink cell.

test("greyscale preserves the ink/pencil distinction by weight, border and tag", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Force every pixel to black and white; the distinction must hold on the
  // non-colour signals alone — font weight, a dashed left border and the text
  // tag — so it survives printing (ui_ux §2, §7).
  await page.addStyleTag({ content: "html { filter: grayscale(1) }" });

  const inkStyle = await page
    .getByTestId("opsp-content-purpose")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontWeight: s.fontWeight, borderLeftStyle: s.borderLeftStyle };
    });
  const pencilStyle = await page
    .getByTestId("opsp-content-bhag")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontWeight: s.fontWeight, borderLeftStyle: s.borderLeftStyle };
    });

  // Ink: solid, no dashed left border. Pencil: lighter weight and dashed.
  expect(inkStyle.borderLeftStyle).toBe("none");
  expect(pencilStyle.borderLeftStyle).toBe("dashed");
  expect(pencilStyle.fontWeight).not.toBe(inkStyle.fontWeight);

  // The text tag is the third non-colour signal and appears only on pencil.
  await expect(page.getByTestId("opsp-revisit-bhag")).toHaveText(OPSP_REVISIT_TAG);
  await expect(page.getByTestId("opsp-revisit-purpose")).toHaveCount(0);
});

test("low-confidence and empty cells carry their respective notes", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // A pencil cell whose cause is a low-confidence feeding answer shows the
  // low-confidence note (the seed's Q4 is low-confidence → BHAG).
  await expect(page.getByTestId("opsp-note-bhag")).toHaveText(
    OPSP_LOW_CONFIDENCE_NOTE,
  );

  // An empty cell shows the empty note and is never auto-filled (the seed's
  // SWT — Threats cell is empty, as Q13 has no `cause` fragment).
  await expect(page.getByTestId("opsp-note-swt_threats")).toHaveText(
    OPSP_EMPTY_NOTE,
  );
  await expect(page.getByTestId("opsp-content-swt_threats")).toBeEmpty();

  // A confident ink cell (Purpose) carries neither a note nor a revisit tag.
  await expect(page.getByTestId("opsp-note-purpose")).toHaveCount(0);
  await expect(page.getByTestId("opsp-revisit-purpose")).toHaveCount(0);

  // A Part B pencil at full confidence (the seed's Q7 → Brand Promise) keeps
  // the revisit tag but shows no low-confidence note.
  await expect(page.getByTestId("opsp-revisit-brand_promise")).toHaveText(
    OPSP_REVISIT_TAG,
  );
  await expect(page.getByTestId("opsp-note-brand_promise")).toHaveCount(0);
});

// F07-T04 — the "How to read this" panel (FR-25, ui_ux.md §4.14). The panel's
// content is the static, repository-authored text from lib/opsp-howto.ts
// (never generated or fetched at runtime, which the unit test in
// opsp-howto.test.ts pins); these tests exercise the two interactive claims:
// every cell has an explanation rendered in the panel, and activating a cell
// moves the panel to that entry on both the desktop right-hand column and the
// mobile bottom sheet.

test("every cell has an explanation in the static how-to panel", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");

  const panel = page.getByTestId("opsp-howto-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("opsp-howto-title")).toContainText(
    "How to read this",
  );

  // The panel renders one explanation per Part B cell, and each entry covers
  // the three §4.14 aspects — the panel is a static guide, not a stub.
  for (const id of OPSP_CELL_IDS) {
    const entry = page.getByTestId(`opsp-howto-${id}`);
    await expect(entry).toBeVisible();
    await expect(entry.getByText("Strong:", { exact: false })).toBeVisible();
    await expect(entry.getByText("Weak:", { exact: false })).toBeVisible();
  }
});

test("tapping a cell scrolls the how-to panel to its explanation (desktop)", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-howto-panel")).toBeVisible();

  // Activating a low cell (Capacity) brings its authored explanation into view
  // inside the persistent right-hand panel. The panel is sticky, so the entry
  // entering the panel's scroll area is visible in the viewport.
  await page.getByTestId("opsp-howto-trigger-capacity").click();
  await expect(page.getByTestId("opsp-howto-capacity")).toBeInViewport();
  await expect(page.getByTestId("opsp-howto-capacity")).toContainText(
    "weekly hours",
  );

  // A different cell re-targets the panel to its own entry.
  await page.getByTestId("opsp-howto-trigger-purpose").click();
  await expect(page.getByTestId("opsp-howto-purpose")).toBeInViewport();
  await expect(page.getByTestId("opsp-howto-purpose")).toContainText(
    "the company exists",
  );
});

test("tapping a cell reveals the bottom sheet and scrolls to its explanation (mobile)", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/opsp");

  // On mobile the panel is a bottom sheet: collapsed to a header bar until a
  // cell is activated, then expanded so the matching entry is reachable.
  const panel = page.getByTestId("opsp-howto-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("opsp-howto-title")).toContainText(
    "How to read this",
  );
  // The toggle is a mobile affordance; the sheet starts collapsed.
  await expect(page.getByTestId("opsp-howto-toggle")).toBeVisible();
  await expect(page.getByTestId("opsp-howto-body")).toBeHidden();

  // Scroll the target cell to the middle of the viewport so its trigger is not
  // obscured by the collapsed sheet, then activate it.
  await page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="opsp-howto-trigger-quarterly_rocks"]',
    );
    el?.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await page.getByTestId("opsp-howto-trigger-quarterly_rocks").click();

  // The sheet expands and scrolls to that cell's explanation.
  await expect(page.getByTestId("opsp-howto-body")).toBeVisible();
  const entry = page.getByTestId("opsp-howto-quarterly_rocks");
  await expect(entry).toBeVisible();
  await expect(entry).toBeInViewport();
  await expect(entry).toContainText("done-when");
});