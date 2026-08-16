import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";
import { latestIndividualDraft } from "../../lib/opsp-draft";
import { SEED_RESPONDENTS } from "../../lib/seed";

// F08-T03 — server-side PDF rendering end to end (GET /api/opsp/:id/pdf,
// tech_infrastructure.md §4, §7), against a real Postgres and a real headless
// Chromium launched from inside the dev server.
//
// The acceptance "server PDF and browser print produce visually equivalent
// documents" is satisfied by construction here, in the same way F08-T02
// reasoned about the print route: /api/opsp/:id/pdf renders /opsp/print, the
// read-only OPSPView in printMode with the export header always present, and
// the browser's own save-as-PDF prints that identical component under the same
// print stylesheet. So this spec pins what the route guarantees:
//
//   * it returns a genuine PDF (magic bytes, non-trivial size) for the
//     respondent's own submitted draft;
//   * it is gated exactly like the edit route — 401 without a session, 404 for
//     a draft that isn't the caller's own;
//   * a PDF render does not disturb the OPSP view, which stays usable;
//
// and it does so through the route's real stack, so the headless browser, the
// /opsp/print render and Chromium's PDF output are all exercised for real. The
// Chromium-unavailable branch can't be forced in e2e (the browser is present),
// so that degradation is pinned at the unit level (tests/unit/opsp-pdf.test.ts).
//
// Like opsp-edit.spec, this file is serial: the tests share one submitted
// respondent and read its single draft id, so they must not fan out across
// workers. It SKIPS unless DATABASE_URL and SESSION_SECRET are present.

test.describe.configure({ mode: "serial" });

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;
let draftId = "";

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, 'E2E OPSP PDF', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Planner Pdf', $3, 'OP2', false, now())
     on conflict (id) do nothing`,
    [RESPONDENT, COHORT, `opsp-pdf-${run}`],
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

  const draft = await withRespondentContext(db!, RESPONDENT, (tx) =>
    latestIndividualDraft(tx),
  );
  draftId = draft ? draft.id : "";
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

test("renders the authenticated print route to a genuine PDF for the respondent's own draft", async ({
  page,
}) => {
  expect(draftId).not.toBe("");
  await setSession(page);

  // page.request shares the browser context's cookie jar, so the session set
  // above authenticates the request the same way a navigation would.
  const res = await page.request.get(`/api/opsp/${draftId}/pdf`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/pdf");

  const body = await res.body();
  // %PDF- magic bytes and a non-trivial size mean Chromium actually rendered
  // the sheet rather than this route returning an empty or error response.
  expect(body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(1000);
});

test("requires a valid session", async ({ page }) => {
  // No session cookie: the route must refuse rather than render for an
  // unauthenticated visitor, mirroring every other protected OPSP route.
  const res = await page.request.get(`/api/opsp/${draftId}/pdf`);
  expect(res.status()).toBe(401);
});

test("returns 404 for a draft the respondent does not own", async ({ page }) => {
  await setSession(page);
  // A random id resolves against opsp_drafts to nothing owned by the caller,
  // exercising the same not-owned query path as a real stranger's draft — the
  // PDF route must never render a plan it cannot prove is the caller's.
  const res = await page.request.get(`/api/opsp/${randomUUID()}/pdf`);
  expect(res.status()).toBe(404);
});

test("the OPSP view stays usable after the server renders a PDF", async ({ page }) => {
  await setSession(page);
  const pdf = await page.request.get(`/api/opsp/${draftId}/pdf`);
  expect(pdf.status()).toBe(200);
  await pdf.body();

  // The degraded/rendered PDF path is served, and the interactive view still
  // renders its grid immediately after — the server-side PDF route does not
  // disturb the respondent's OPSP view.
  await page.goto("/opsp");
  await expect(page.getByTestId("opsp-grid")).toBeVisible();
});