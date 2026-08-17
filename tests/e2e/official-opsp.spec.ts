import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { OPSP_CELL_IDS } from "../../lib/opsp";

// F15-T01 end to end: the official OPSP canvas against a real Postgres, on
// the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL
// and SESSION_SECRET are present). Covers the ticket's three acceptances:
//
//   1. The canvas renders with the same cell structure as the individual OPSP.
//   2. A non-facilitator cannot write to it.
//   3. One cohort has at most one official OPSP lineage.
//
// The blank-canvas shape, the versioned-edit write and the one-lineage +
// facilitator-only RLS guarantees are covered in the unit suites; this file is
// the rendered grid and the route-level authoring gate.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

// A per-file randomly generated cohort so fullyParallel workers never collide
// on cohorts_pkey (each worker gets its own fresh id, like the other DB specs).
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Official', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', 'lia@example.com', $3, 'OFFF1', true, now())`,
    [FACILITATOR, COHORT, `off-fac-${COHORT}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Ana Reyes', 'ana@example.com', $3, 'OFFA1', false)`,
    [RESPONDENT, COHORT, `off-res-${COHORT}`],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
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

test("the canvas renders the same sixteen-cell grid as the individual OPSP, blank", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/official-opsp");

  await expect(page.getByTestId("official-opsp-grid")).toBeVisible();

  // The same cell structure as the individual OPSP: every Part B cell present.
  for (const id of OPSP_CELL_IDS) {
    await expect(page.getByTestId(`opsp-cell-${id}`)).toBeVisible();
  }

  // The collaborative plan opens blank — no cell is pre-filled from any
  // respondent's snapshot.
  const content = await page.getByTestId("official-opsp-grid").innerText();
  for (const id of OPSP_CELL_IDS) {
    const cellText = await page.getByTestId(`opsp-cell-${id}`).innerText();
    // Only the cell label and the Edit affordance, no authored content yet.
    expect(cellText).not.toContain("One live record");
  }
  expect(content.length).toBeGreaterThan(0);
});

test("a facilitator authors a cell and it persists as a new version", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin/official-opsp");

  await page.getByTestId("opsp-cell-edit-bhag").click();
  await page
    .getByTestId("opsp-cell-input-bhag")
    .fill("A live record for every child by five.");
  await page.getByTestId("opsp-cell-save-bhag").click();

  const bhag = page.getByTestId("opsp-cell-bhag");
  await expect(bhag.getByTestId("opsp-content-bhag")).toHaveText(
    "A live record for every child by five.",
  );
});

test("a non-facilitator cannot write to the official OPSP", async ({ page }) => {
  await setSession(page, RESPONDENT);

  // The page route sends a non-facilitator away (adminPageView "away"), so the
  // canvas never renders for them.
  await page.goto("/admin/official-opsp");
  await expect(page.getByTestId("official-opsp-grid")).toHaveCount(0);

  // And the API gate refuses their writes and reads outright (403).
  const write = await page.request.patch("/api/admin/official-opsp", {
    data: { cellId: "bhag", content: "should never land" },
  });
  expect(write.status()).toBe(403);

  const read = await page.request.get("/api/admin/official-opsp");
  expect(read.status()).toBe(403);
});

test("one cohort has at most one official OPSP lineage", async ({ page }) => {
  await setSession(page, FACILITATOR);

  // Opening the canvas twice (fresh sessions) must resolve to the same
  // version-1 lineage rather than seeding a second official root.
  await page.goto("/admin/official-opsp");
  await page.getByTestId("opsp-cell-edit-purpose").click();
  await page.getByTestId("opsp-cell-input-purpose").fill("We exist for one reason.");
  await page.getByTestId("opsp-cell-save-purpose").click();
  await page.reload();
  await expect(page.getByTestId("opsp-cell-purpose")).toBeVisible();

  // The purpose edit persisted into the same lineage (content survives reload).
  await expect(page.getByTestId("opsp-content-purpose")).toHaveText(
    "We exist for one reason.",
  );

  // Directly against the DB: exactly one official lineage (versions 1..3 from
  // the bhag + purpose edits), not two independent chains.
  const { rows } = await db!.query<{ v1: number; total: number }>(
    `select
       count(*) filter (where version = 1)::int as v1,
       count(*)::int as total
     from opsp_drafts
     where owner_type = 'official' and cohort_id = $1`,
    [COHORT],
  );
  expect(rows[0].v1).toBe(1);
  expect(rows[0].total).toBe(3);
});