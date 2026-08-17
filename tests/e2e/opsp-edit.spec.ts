import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import { latestIndividualDraft } from "../../lib/opsp-draft";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F07-T05 — OPSP editing and versioning end to end (FR-26, PR5,
// ui_ux.md §4.15), against a real Postgres.
//
//   * The persistent note in the edit bar is visible throughout editing, not
//     shown once (acceptance: "the persistent note is visible throughout
//     editing").
//   * Saving an inline edit writes a new opsp_drafts version and the edit
//     survives a reload (the latest version is read back — acceptance A1's
//     "prior versions intact" is verified at the data layer in the unit DB
//     test, this exercises the round trip).
//   * The ink/pencil mark is manually togglable per cell and persists.
//
// Each edit writes a new draft version, so these tests share one submitted
// respondent but must not race through the version counter. The file is
// therefore serial: tests run one at a time, each seeing the previous edit's
// committed version. It SKIPS unless DATABASE_URL and SESSION_SECRET are
// present, like the other DB-gated e2e specs, and routes every write through
// the UI (PATCH /api/opsp/:id) rather than calling the edit lib directly.

test.describe.configure({ mode: "serial" });

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
     values ($1, 'E2E OPSP Edit', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Planner Edit', $3, 'OP2', false, now())
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, `opsp-edit-${run}`],
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
  // Real submit creates the individual draft at version 1 that the /opsp page
  // renders and the edit UI targets.
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
  await db.query(
    "delete from opsp_drafts where owner_type = 'individual' and owner_id = any($1::uuid[])",
    [ids],
  );
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

/** The respondent's latest draft version number, read from Postgres. */
async function latestVersion(): Promise<number> {
  return withRespondentContext(db!, RESPONDENT, async (tx) => {
    const draft = await latestIndividualDraft(tx);
    return draft ? draft.version : 0;
  });
}

const EDIT_BAR_NOTE =
  "Editing this doesn't change your survey answers — those stay as you submitted them.";

test("the edit bar note is persistent and visible throughout editing, not shown once", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // The note is present before any editing starts.
  const bar = page.getByTestId("opsp-edit-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText(EDIT_BAR_NOTE);

  // Entering edit mode keeps the note on screen.
  await page.getByTestId("opsp-cell-edit-capacity").click();
  await expect(page.getByTestId("opsp-cell-input-capacity")).toBeVisible();
  await expect(bar).toContainText(EDIT_BAR_NOTE);

  // Typing (still editing) keeps the note on screen.
  await page.getByTestId("opsp-cell-input-capacity").fill("Twenty hours.");
  await expect(bar).toContainText(EDIT_BAR_NOTE);

  // Cancelling leaves the draft unedited and the note still present.
  await page.getByTestId("opsp-cell-cancel-capacity").click();
  await expect(bar).toContainText(EDIT_BAR_NOTE);
});

test("saving an inline edit writes a new version and the edit survives a reload", async ({
  page,
}) => {
  const before = await latestVersion();

  await setSession(page);
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Edit the Purpose cell inline and save.
  await page.getByTestId("opsp-cell-edit-purpose").click();
  await page.getByTestId("opsp-cell-input-purpose").fill("Every child seen, every week.");
  await page.getByTestId("opsp-cell-save-purpose").click();

  // The view adopts the returned cells: the rewritten text is shown, and a
  // new version was written to Postgres.
  await expect(page.getByTestId("opsp-content-purpose")).toHaveText(
    "Every child seen, every week.",
  );
  expect(await latestVersion()).toBe(before + 1);

  // The edit survives a reload — the latest version is read back.
  await page.reload();
  await expect(page.getByTestId("opsp-content-purpose")).toHaveText(
    "Every child seen, every week.",
  );
});

test("the ink/pencil mark is manually togglable per cell and persists", async ({
  page,
}) => {
  const before = await latestVersion();

  await setSession(page);
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();

  // Capacity is ink by default (no revisit tag, solid content). Toggle it to
  // pencil and save.
  await page.getByTestId("opsp-cell-edit-capacity").click();
  await page.getByTestId("opsp-mark-pencil-capacity").click();
  await page.getByTestId("opsp-cell-save-capacity").click();

  // Pencil renders with the revisit tag on the same cell.
  await expect(page.getByTestId("opsp-revisit-capacity")).toBeVisible();
  expect(await latestVersion()).toBe(before + 1);

  // Reload and toggle back to ink: the revisit tag disappears.
  await page.reload();
  await page.getByTestId("opsp-cell-edit-capacity").click();
  await page.getByTestId("opsp-mark-ink-capacity").click();
  await page.getByTestId("opsp-cell-save-capacity").click();
  await expect(page.getByTestId("opsp-revisit-capacity")).toHaveCount(0);
});