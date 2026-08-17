import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import { OPSP_CELL_IDS } from "../../lib/opsp";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F08-T01 — the print stylesheet (FR-27, tech_infrastructure.md §7, ui_ux.md
// §4.16). The print layout is the OPSP re-laid-out for a sheet, not the screen
// scaled down. These tests emulate print media (page.emulateMedia) against a
// real submitted draft and pin the three acceptance criteria:
//
//   * Printed at greyscale, ink and pencil are distinguishable without colour.
//     Ink is solid weight with no left border; pencil is a lighter weight
//     behind a dashed left border. Colour plays no part.
//   * No section is split awkwardly across a page break. Every cell carries
//     break-inside: avoid, so a break lands between sections, never through
//     one.
//   * No interactive chrome appears in the printed output. The edit bar, each
//     cell's Edit and "What's this?" buttons, the edit-mode controls, and the
//     whole "How to read this" panel are all hidden in print.
//
// It also asserts the print layout is genuinely distinct from the screen: at a
// 360px viewport, where the screen stacks the plan into one column, the printed
// plan is still a two-column grid — the mobile phone layout is not what hits
// paper.
//
// Like the F07 opsp.spec, this spec seeds a respondent with the full answer set
// and runs real submit, and SKIPS unless DATABASE_URL and SESSION_SECRET are
// present.

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
     values ($1, 'E2E OPSP Print', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Planner Two', $3, 'OP2', false, now())
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, `opsp-print-${run}`],
  );

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

test("print re-lays the plan into two full-width columns, not the phone's stacked screen", async ({
  page,
}) => {
  await setSession(page);
  // A narrow phone viewport: on screen this stacks the OPSP to one column
  // (F07-T02, opsp.spec). Under print media the plan must not inherit that —
  // it re-lays out as a two-column grid.
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  expect(await gridColumns(page)).toBe(2);

  // The outer screen wrapper is flattened so the plan spans the full sheet —
  // the absent how-to panel leaves no empty half-column (F08-T01).
  const documentDisplay = await page
    .getByTestId("opsp-document")
    .evaluate((el) => getComputedStyle(el).display);
  expect(documentDisplay).toBe("block");
});

test("printed at greyscale, ink and pencil are distinguishable by weight and border, not colour", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Force every pixel to black and white. The distinction must hold on weight
  // and a dashed border alone — colour is not the signal (ui_ux §2, §7).
  await page.addStyleTag({ content: "html { filter: grayscale(1) }" });

  // The seed's Purpose cell is a confident ink cell; BHAG is a pencil default.
  const inkStyle = await page
    .getByTestId("opsp-content-purpose")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontWeight: Number(s.fontWeight), borderLeftStyle: s.borderLeftStyle };
    });
  const pencilStyle = await page
    .getByTestId("opsp-content-bhag")
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontWeight: Number(s.fontWeight), borderLeftStyle: s.borderLeftStyle };
    });

  expect(inkStyle.borderLeftStyle).toBe("none");
  expect(pencilStyle.borderLeftStyle).toBe("dashed");
  expect(pencilStyle.fontWeight).toBeLessThan(inkStyle.fontWeight);
});

test("no OPSP section splits across a page break", async ({ page }) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Every one of the sixteen sections carries break-inside: avoid, so a page
  // break can fall between sections but never through one.
  for (const id of OPSP_CELL_IDS) {
    const cell = page.getByTestId(`opsp-cell-${id}`);
    await expect(cell).toBeVisible();
    const style = await cell.evaluate((el) => {
      const s = getComputedStyle(el);
      return { breakInside: s.breakInside, legacy: (s as CSSStyleDeclaration & { pageBreakInside: string }).pageBreakInside };
    });
    expect(style.breakInside).toBe("avoid");
    expect(style.legacy).toBe("avoid");
  }
});

test("no interactive chrome appears in the printed output", async ({ page }) => {
  await setSession(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ media: "print" });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // The persistent edit bar that always sits above the grid on screen (F07-T05).
  await expect(page.getByTestId("opsp-edit-bar")).toBeHidden();

  // The whole "How to read this" panel and its mobile toggle (F07-T04).
  await expect(page.getByTestId("opsp-howto-panel")).toBeHidden();
  await expect(page.getByTestId("opsp-howto-toggle")).toBeHidden();

  // Per-cell editing controls: the Edit and "What's this?" actions, plus the
  // edit-mode controls, none of which exist on paper.
  const spotCheck: string[] = [
    "opsp-cell-edit-purpose",
    "opsp-cell-edit-bhag",
    "opsp-howto-trigger-purpose",
    "opsp-mark-ink-purpose",
    "opsp-mark-pencil-purpose",
    "opsp-cell-cancel-purpose",
    "opsp-cell-save-purpose",
  ];
  for (const testId of spotCheck) {
    await expect(page.getByTestId(testId)).toBeHidden();
  }
});

// --- F08-T02 — print route and client save-as-PDF (FR-27,
// tech_infrastructure §7, ui_ux §4.16). Two export paths, one sheet: the
// primary path is window.print() from the OPSP view with no server round trip,
// and the /opsp/print route serves the identical sheet read-only. Both carry
// the respondent's name, a timestamp and the FR-23 draft label.
//
// The print-only export header is hidden on screen and revealed under print
// media, so the on-screen OPSP header stays intact while paper carries the
// FR-27 identity.

test("a Save as PDF trigger is reachable on desktop and mobile and prints with no server round trip", async ({
  page,
}) => {
  await setSession(page);
  // Stub window.print so clicking the trigger is observable as a client call.
  await page.addInitScript(() => {
    const w = window as unknown as { __printCalls?: number };
    window.print = () => {
      w.__printCalls = (w.__printCalls ?? 0) + 1;
    };
  });

  const apiCalls: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/opsp")) apiCalls.push(req.url());
  });

  // Desktop.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  const trigger = page.getByTestId("opsp-print-trigger");
  await expect(trigger).toBeVisible();
  await trigger.click();
  expect(await page.evaluate(() => (window as unknown as { __printCalls?: number }).__printCalls)).toBeGreaterThan(0);

  // The trigger is present on a phone viewport too, so save-as-PDF is
  // reachable from a mobile browser.
  await page.setViewportSize({ width: 360, height: 780 });
  await expect(trigger).toBeVisible();

  // The primary export path is client-side: clicking it fired no OPSP request.
  expect(apiCalls).toEqual([]);
});

test("printed from the OPSP view, the sheet carries the name, timestamp and draft label", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  await page.emulateMedia({ media: "print" });

  // The export header is revealed only under print media, so the screen stays
  // clean while paper carries the FR-27 identity.
  await expect(page.getByTestId("opsp-print-header")).toBeVisible();
  await expect(page.getByTestId("opsp-print-name")).toContainText("Planner Two");
  await expect(page.getByTestId("opsp-print-timestamp")).toContainText("Generated");
  await expect(page.getByTestId("opsp-print-label")).toHaveText(
    "Your draft — not the company's plan",
  );

  // The on-screen draft header and the export trigger are hidden on paper: the
  // print header is the single source of the label.
  await expect(page.getByTestId("opsp-draft-label")).toBeHidden();
  await expect(page.getByTestId("opsp-print-trigger")).toBeHidden();
});

test("the print route requires a valid session", async ({ page }) => {
  // No session cookie: the route redirects to the claim screen rather than
  // rendering a plan for an unauthenticated visitor.
  await page.goto("/opsp/print");
  await expect(page).toHaveURL("/");
});

test("the print route serves the same sheet read-only, with name, timestamp and draft label", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/opsp/print");

  await expect(page.getByTestId("opsp-print-header")).toBeVisible();
  await expect(page.getByTestId("opsp-print-name")).toContainText("Planner Two");
  await expect(page.getByTestId("opsp-print-timestamp")).toContainText("Generated");
  await expect(page.getByTestId("opsp-print-label")).toHaveText(
    "Your draft — not the company's plan",
  );

  // The grid renders, and the interactive view's chrome is absent from the
  // DOM entirely rather than merely hidden in print.
  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  await expect(page.getByTestId("opsp-draft-label")).toHaveCount(0);
  await expect(page.getByTestId("opsp-edit-bar")).toHaveCount(0);
  await expect(page.getByTestId("opsp-cell-edit-purpose")).toHaveCount(0);
  await expect(page.getByTestId("opsp-howto-panel")).toHaveCount(0);
});