import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";

// F09-T05 end to end: the cohort lifecycle on the admin dashboard, against a
// real Postgres on the same opt-in as the other DB-gated e2e specs (SKIP unless
// DATABASE_URL and SESSION_SECRET are present). Covers the ticket's three
// acceptances:
//
//   1. Closing a cohort does not break OPSP or PDF access — the respondent's
//      answer writes are refused (read-only) while reading their OPSP draft,
//      and the PDF route, stays reachable.
//   2. Deletion is one facilitator action that cascades — no orphaned answers,
//      snapshots, drafts, interactions or budget rows, and a wrong name
//      confirmation deletes nothing.
//   3. A level pin takes effect on the next request without a redeploy — the
//      dashboard strip reflects the pinned level immediately.
//
// The mutating HTTP conveniences (POST/DELETE /api/admin/cohort) are exercised
// over the wire; the pure derivations live in tests/unit/cohort-lifecycle.test.ts
// and the DB cascade at the function level in
// tests/unit/cohort-lifecycle.integration.test.ts.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESPONDENT = randomUUID();
const COHORT_NAME = `E2E Cohort ${run}`;

let db: Client | null = null;
let draftId: string | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, $2, 'Q4 2026', 'open')",
    [COHORT, COHORT_NAME],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        submitted_at, ground_rules_acknowledged_at)
     values ($1, $2, 'Lia Mendoza', $3, 'LCLF1', true, now(), now())`,
    [FACILITATOR, COHORT, `cohort-fac-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Tory Norm', $3, 'LCLR1', false, now())`,
    [RESPONDENT, COHORT, `cohort-res-${run}`],
  );

  // A submitted respondent with a real OPSP draft, so closing the cohort can be
  // shown to preserve OPSP/PDF access.
  await withRespondentContext(db!, RESPONDENT, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: RESPONDENT,
      question_id: "q1",
      value: { text: "a baseline that must remain readable after close" },
    });
  });
  const submit = await performSubmit(db!, RESPONDENT, COHORT);
  draftId = submit.draftId ?? null;
});

test.afterAll(async () => {
  if (!db) return;
  try {
    // The cohort may already have been deleted by a test; cascade defensively.
    await db
      .query("delete from ai_budget where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db
      .query(
        `delete from ai_interactions
          where respondent_id in (select id from respondents where cohort_id = $1)`,
        [COHORT],
      )
      .catch(() => {});
    await db
      .query("delete from opsp_drafts where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db
      .query(
        `delete from answer_snapshots
          where respondent_id in (select id from respondents where cohort_id = $1)`,
        [COHORT],
      )
      .catch(() => {});
    await db
      .query(
        `delete from answers
          where respondent_id in (select id from respondents where cohort_id = $1)`,
        [COHORT],
      )
      .catch(() => {});
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
  } finally {
    await db.end();
  }
});

function cookie(respondentId: string) {
  return `${SESSION_COOKIE}=${createSessionToken({ respondentId, cohortId: COHORT })}`;
}

async function setSession(page: Page, respondentId: string) {
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: createSessionToken({ respondentId, cohortId: COHORT }), domain: "127.0.0.1", path: "/" },
  ]);
}

function asFac(request: APIRequestContext) {
  return (method: "GET" | "POST" | "DELETE", url: string, body?: unknown) =>
    request.fetch(url, {
      method,
      headers: { cookie: cookie(FACILITATOR), "Content-Type": "application/json" },
      data: body,
    });
}

test("the dashboard renders the cohort lifecycle control", async ({ page }) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin");

  const lifecycle = page.getByTestId("cohort-lifecycle");
  await expect(lifecycle).toBeVisible();
  await expect(lifecycle.getByTestId("cohort-status-open")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(lifecycle.getByTestId("cohort-level-pin")).toHaveValue("auto");
});

test("a level pin takes effect on the next request without a redeploy", async ({
  page,
  request,
}) => {
  const api = asFac(request);
  const res = await api("POST", "/api/admin/cohort", { aiLevelPin: "L3" });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.cohort).toMatchObject({ aiLevelPin: "L3", servedLevel: "L3" });

  // The strip reflects the pinned level on the very next page load.
  await setSession(page, FACILITATOR);
  await page.goto("/admin");
  await expect(page.getByTestId("strip-level")).toHaveText("L3");

  // Restore for the other tests.
  await api("POST", "/api/admin/cohort", { aiLevelPin: "auto" });
});

test("closing a cohort makes writes read-only while OPSP/PDF access stays", async ({
  request,
}) => {
  const api = asFac(request);
  const res = await api("POST", "/api/admin/cohort", { status: "closed" });
  expect(res.status()).toBe(200);

  // The respondent's writes are now refused server-side (read-only).
  const patch = await request.fetch("/api/answers", {
    method: "PATCH",
    headers: { cookie: cookie(RESPONDENT), "Content-Type": "application/json" },
    data: { question_id: "q7", value: { text: "should be refused when closed" } },
  });
  expect(patch.status()).toBe(403);

  // But their OPSP draft is still readable — closing does not break OPSP access.
  const op = await request.fetch(`/api/opsp/${draftId}`, {
    headers: { cookie: cookie(RESPONDENT) },
  });
  expect(op.status()).toBe(200);

  // And the PDF route is still reachable (not blocked by the closed cohort).
  // It is gated only on session + draft ownership; Chromium availability
  // decides 200 vs the route-only 503, never a cohort-status 403.
  const pdf = await request.fetch(`/api/opsp/${draftId}/pdf`, {
    headers: { cookie: cookie(RESPONDENT) },
  });
  expect([200, 503]).toContain(pdf.status());

  // Reopen so the delete test starts from an open cohort.
  await api("POST", "/api/admin/cohort", { status: "open" });
});

test("deleting requires the cohort name and cascades with no orphans", async ({
  request,
}) => {
  const api = asFac(request);

  // A wrong name is refused and the cohort survives.
  const wrong = await api("DELETE", "/api/admin/cohort", { name: "not the name" });
  expect(wrong.status()).toBe(409);
  const stillThere = await api("GET", "/api/admin/cohort");
  expect(stillThere.status()).toBe(200);

  // The correct name deletes the whole cohort in one action.
  const del = await api("DELETE", "/api/admin/cohort", { name: COHORT_NAME });
  expect(del.status()).toBe(200);

  // The cohort is gone, and the facilitator's respondent row with it — so
  // their old session no longer resolves at all (401), which is the honest
  // post-deletion state. Deletion is verified by the orphan query below.
  const gone = await api("GET", "/api/admin/cohort");
  expect(gone.status()).toBe(401);

  // No orphaned dependent rows remain for that cohort.
  const counts = await db!.query(
    `select
       (select count(*) from cohorts where id = $1)::int as cohort,
       (select count(*) from respondents where cohort_id = $1)::int as respondents,
       (select count(*) from answers where respondent_id in (select id from respondents where cohort_id = $1))::int as answers,
       (select count(*) from answer_snapshots where respondent_id in (select id from respondents where cohort_id = $1))::int as snapshots,
       (select count(*) from opsp_drafts where cohort_id = $1)::int as drafts,
       (select count(*) from ai_interactions where respondent_id in (select id from respondents where cohort_id = $1))::int as interactions,
       (select count(*) from ai_budget where cohort_id = $1)::int as budget`,
    [COHORT],
  );
  const c = counts.rows[0];
  expect(c).toEqual({
    cohort: 0,
    respondents: 0,
    answers: 0,
    snapshots: 0,
    drafts: 0,
    interactions: 0,
    budget: 0,
  });
});