import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import {
  createOfficialDraftVersion,
  getOrCreateOfficialDraft,
  takeOfficialSnapshot,
} from "../../lib/official-opsp";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F15-T07 — versioning and export of the official OPSP (FR-42,
// tech_infrastructure §4, ui_ux §4.20) against a real Postgres. Covers the
// three acceptances:
//
//   1. Taking a snapshot and continuing to edit leaves the snapshot unchanged —
//      exercised through the UI (view a snapshot, back to the working plan).
//   2. Export renders through the shared F08 print stylesheet — the /admin/
//      official-opsp/print route re-lays the grid into two columns under print
//      media with no interactive chrome, just like the individual sheet.
//   3. No private content reaches the export — a respondent's Q14(d) note never
//      surfaces on the official print route or the server PDF, because the
//      official sheet is built from `opsp_drafts` cells alone.
//
// The data is set up deterministically in beforeAll: author a cell, snapshot it
// as "Q4 2026 v1", then author a second edit — so the snapshot is frozen at
// "One live record..." while the working plan moves to "Two live records...".
// Serial: the tests share one facilitator/respondent and one draft lineage, so
// they must not fan out across workers.

test.describe.configure({ mode: "serial" });

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESPONDENT = randomUUID();

// F15-T07 — a distinctive substring of SEED_RESPONDENTS[0]'s Q14(d) note. It
// must never surface on the official print route or the official PDF.
const PRIVATE_NOTE_PHRASE = "still unpaid by March I will need to take a job";

const SNAPSHOT_LABEL = "Q4 2026 v1";
const SNAPSHOT_BHAG = "One live record for every child.";
const LATER_BHAG = "Two live records for every family.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, 'E2E Official Versioning', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', 'lia@example.com', $3, 'OFV1', true, now())
     on conflict (id) do nothing`,
    [FACILITATOR, COHORT, `off-ver-fac-${COHORT}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Ana Reyes', 'ana@example.com', $3, 'OFV2', false)
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, `off-ver-res-${COHORT}`],
  );

  // Seed the full answer set (including Ana's Q14(d) private note) and submit,
  // so a non-private answer exists to feed source cards and the private note is
  // present as the thing the official export must never leak.
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

  // Set up the official plan lineage deterministically: author a cell, snapshot
  // it under a name, then keep editing the working plan. The snapshot is frozen
  // at SNAPSHOT_BHAG while the working plan moves to LATER_BHAG.
  await getOrCreateOfficialDraft(db!, FACILITATOR, COHORT);
  await createOfficialDraftVersion(db!, FACILITATOR, COHORT, {
    cellId: "bhag",
    content: SNAPSHOT_BHAG,
    mark: "ink",
  });
  await takeOfficialSnapshot(db!, FACILITATOR, COHORT, SNAPSHOT_LABEL);
  await createOfficialDraftVersion(db!, FACILITATOR, COHORT, {
    cellId: "bhag",
    content: LATER_BHAG,
    mark: "ink",
  });
});

test.afterAll(async () => {
  if (!db) return;
  await db.query("delete from answers where respondent_id = $1", [RESPONDENT]);
  await db.query("delete from answer_snapshots where respondent_id = $1", [RESPONDENT]);
  await db.query("delete from opsp_drafts where cohort_id = $1", [COHORT]);
  await db.query("delete from respondents where cohort_id = $1", [COHORT]);
  await db.query("delete from cohorts where id = $1", [COHORT]);
  await db.end();
});

async function setSession(page: Page, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

test("taking a snapshot and continuing to edit leaves the snapshot unchanged", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);

  // The working plan shows the later edit.
  await page.goto("/admin/official-opsp");
  await expect(page.getByTestId("official-opsp-grid")).toBeVisible();
  await expect(page.getByTestId("opsp-content-bhag")).toHaveText(LATER_BHAG);

  // The version history lists the named snapshot (v3).
  await expect(page.getByTestId("official-version-history")).toBeVisible();
  const snapshotRow = page.getByTestId("official-snapshot-3");
  await expect(snapshotRow).toContainText(SNAPSHOT_LABEL);
  await expect(snapshotRow).toContainText("(v3)");

  // Viewing the snapshot renders its frozen cells, read-only (no edit control,
  // no version-history chrome), with the snapshot banner and a Back action.
  await page.getByTestId("official-snapshot-view-3").click();
  await expect(page.getByTestId("opsp-content-bhag")).toHaveText(SNAPSHOT_BHAG);
  await expect(page.getByTestId("official-snapshot-viewing")).toBeVisible();
  await expect(page.getByTestId("opsp-cell-edit-bhag")).toHaveCount(0);
  await expect(page.getByTestId("official-version-history")).toHaveCount(0);

  // Back to the working plan returns the later edit.
  await page.getByTestId("official-snapshot-back").click();
  await expect(page.getByTestId("opsp-content-bhag")).toHaveText(LATER_BHAG);
  await expect(page.getByTestId("official-version-history")).toBeVisible();
});

test("the print route renders the official plan through the shared print stylesheet", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.emulateMedia({ media: "print" });
  await page.goto("/admin/official-opsp/print");

  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // The export header carries the official-plan identity, cohort label and a
  // timestamp — the shared F08 header, but for the company's plan.
  await expect(page.getByTestId("opsp-print-label")).toHaveText(
    "Official One-Page Strategic Plan",
  );
  await expect(page.getByTestId("opsp-print-name")).toContainText("Q4 2026");
  await expect(page.getByTestId("opsp-print-timestamp")).toContainText("Generated");

  // Re-laid into the shared two-column print grid, not the screen's layout.
  const columns = await page
    .getByTestId("opsp-grid")
    .evaluate((el) =>
      getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .filter((s) => s.trim() !== "").length,
    );
  expect(columns).toBe(2);

  // No interactive chrome — the official sheet is content, not the canvas.
  for (const testId of [
    "opsp-cell-edit-bhag",
    "opsp-add-source-bhag",
    "official-opsp-editing-note",
    "official-version-history",
  ]) {
    await expect(page.getByTestId(testId)).toHaveCount(0);
  }
});

test("no private content reaches the official print route or the server PDF", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);

  // The print route carries none of Ana's private note.
  await page.goto("/admin/official-opsp/print");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();
  await expect(
    page.getByText(PRIVATE_NOTE_PHRASE, { exact: false }),
  ).toHaveCount(0);

  // And the server PDF for the same sheet omits it too.
  const pdf = await page.request.get("/api/admin/official-opsp/export");
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(1000);
  expect(body.toString("latin1").includes(PRIVATE_NOTE_PHRASE)).toBe(false);
});

test("a non-facilitator cannot take snapshots or export the official plan", async ({
  page,
}) => {
  await setSession(page, RESPONDENT);

  const list = await page.request.get("/api/admin/official-opsp/snapshots");
  expect(list.status()).toBe(403);

  const take = await page.request.post("/api/admin/official-opsp/snapshots", {
    data: { label: "should never land" },
  });
  expect(take.status()).toBe(403);

  const exportRes = await page.request.get("/api/admin/official-opsp/export");
  expect(exportRes.status()).toBe(403);
});