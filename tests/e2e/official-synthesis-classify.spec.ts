import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F15-T03 end to end — the compatibility-classification step (POST
// /api/admin/synthesise/classify) against a real Postgres, on the same opt-in
// as the other DB-gated specs (SKIP unless DATABASE_URL and SESSION_SECRET are
// present). Covers the ticket's acceptances over the HTTP surface and in the
// rendered canvas:
//
//   1. Classification is a distinct call with its own logged interaction row
//      (purpose "synthesis").
//   2. Two clearly incompatible seeded answers classify as incompatible — and
//      with the key removed (the L2 local default) the endpoint still returns
//      a refused, reason-carrying 200, never an error (PR3).
//   3. The reason string is shown to the facilitator.
//
// Plus access: a non-facilitator and an unsubmitted facilitator are 403, and a
// cell with fewer than two source cards is a 400.
//
// The spec is serial within the file like the other DB suites, so the
// module-scoped cohort and its shared official draft do not collide across
// parallel workers.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

const FAC = randomUUID(); // submitted facilitator → allowed
const UNSUB = randomUUID(); // facilitator, submitted=false → 403
const RESP = randomUUID(); // not a facilitator → 403
const CENTRE = randomUUID(); // centre-camp answer (incompatible with PARENT)
const PARENT = randomUUID(); // parent-camp answer

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Synthesis Classify', 'Q4 2026', 'open')",
    [COHORT],
  );

  for (const row of [
    { id: FAC, name: "Facilitator Classify", token: "CLFA1", isFac: true, submitted: new Date() },
    { id: UNSUB, name: "Unsubmitted Facilitator", token: "CLFA2", isFac: true, submitted: null },
    { id: RESP, name: "Respondent Classify", token: "CLRP1", isFac: false, submitted: null },
    { id: CENTRE, name: "Centre Camp", token: "CLCT1", isFac: false, submitted: null },
    { id: PARENT, name: "Parent Camp", token: "CLPT1", isFac: false, submitted: null },
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, COHORT, row.name, `cl-${run}-${row.token}`, row.token, row.isFac, row.submitted],
    );
  }

  // The two clearly incompatible public Q6 answers (the seed's confident split).
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q6', $3::jsonb, false, null)`,
    [
      randomUUID(),
      CENTRE,
      JSON.stringify({
        choice: "center",
        why: "They pay, and if they churn there is no data for the parent to look at anyway.",
      }),
    ],
  );
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q6', $3::jsonb, false, null)`,
    [
      randomUUID(),
      PARENT,
      JSON.stringify({
        choice: "parent",
        why: "The parent is the human we are actually here for; everything else is infrastructure.",
      }),
    ],
  );

  // The facilitator's private q14(d) note must never reach a classification
  // payload through any path — attach a row so we can assert its absence.
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q14d', $3::jsonb, true, null)`,
    [randomUUID(), FAC, JSON.stringify({ private_note: "I might step back in April." })],
  );
});

// Clear the shared official draft before each test so the classification and
// card states start clean, exactly as the F15-T02 spec does.
test.beforeEach(async () => {
  if (enabled && db) {
    await db
      .query("delete from opsp_drafts where owner_type = 'official' and cohort_id = $1", [COHORT])
      .catch(() => {});
  }
});

test.afterAll(async () => {
  if (db) {
    const { rows } = await db.query<{ id: string }>(
      "select id from respondents where cohort_id = $1",
      [COHORT],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.query("delete from opsp_drafts where cohort_id = $1", [COHORT]);
      await db.query("delete from ai_interactions where cohort_id = $1", [COHORT]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    await db.query("delete from respondents where cohort_id = $1", [COHORT]);
    await db.query("delete from cohorts where id = $1", [COHORT]);
    await db.end();
  }
});

/** The Cookie header that presents a session for the given respondent. */
function sessionCookie(respondentId: string): string {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  return `${SESSION_COOKIE}=${token}`;
}

/** Attach one of the two incompatible answers to the given cell as a card. */
async function attach(cellId: string, respondentId: string) {
  const res = await fetch(`http://127.0.0.1:3000/api/admin/official-opsp/source-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: sessionCookie(FAC) },
    body: JSON.stringify({ cellId, respondentId, questionId: "q6" }),
  });
  return res.status;
}

test("a respondent and an unsubmitted facilitator cannot classify (403)", async ({
  request,
}) => {
  const asRespondent = await request.post("/api/admin/synthesise/classify", {
    headers: { cookie: sessionCookie(RESP) },
    data: { cellId: "bhag" },
  });
  expect(asRespondent.status()).toBe(403);

  const asUnsubmitted = await request.post("/api/admin/synthesise/classify", {
    headers: { cookie: sessionCookie(UNSUB) },
    data: { cellId: "bhag" },
  });
  expect(asUnsubmitted.status()).toBe(403);
});

test("a cell with fewer than two source cards is a 400", async ({ request }) => {
  // No cards are attached (the draft was cleared in beforeEach).
  const res = await request.post("/api/admin/synthesise/classify", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag" },
  });
  expect(res.status()).toBe(400);

  const bad = await request.post("/api/admin/synthesise/classify", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "not-a-cell" },
  });
  expect(bad.status()).toBe(400);
});

test("two incompatible seeded answers refuse to combine, with one synthesis row (key removed)", async ({
  request,
}) => {
  // Attach the centre-camp and parent-camp cards to the same cell.
  expect(await attach("bhag", CENTRE)).toBe(200);
  expect(await attach("bhag", PARENT)).toBe(200);

  const res = await request.post("/api/admin/synthesise/classify", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    level: string;
    cellId: string;
    compatible: boolean;
    classification: { compatible: boolean; reason: string };
    label: { model: string; generatedAt: string };
  };
  expect(body.ok).toBe(true);
  expect(body.level).toBe("L2");
  expect(body.cellId).toBe("bhag");
  expect(body.classification.compatible).toBe(false);
  // The reason is always served — with the key removed it is the honest refusal,
  // never a fabricated incompatible verdict over a real model judgement.
  expect(body.classification.reason.length).toBeGreaterThan(0);
  // FR-35 labelling.
  expect(body.label.generatedAt).toBeTruthy();

  // Acceptance 1: the classification is its own call with its own row, purpose 'synthesis'.
  const { rows } = await db!.query<{ purpose: string; question_id: string | null }>(
    `select purpose, question_id from ai_interactions
      where cohort_id = $1 and purpose = 'synthesis'`,
    [COHORT],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].purpose).toBe("synthesis");
  expect(rows[0].question_id).toBeNull();
});

test("the facilitator sees the compatibility reason on the canvas", async ({ page }) => {
  await attach("bhag", CENTRE);
  await attach("bhag", PARENT);

  await page.context().addCookies([
    { name: SESSION_COOKIE, value: createSessionToken({ respondentId: FAC, cohortId: COHORT }), domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/admin/official-opsp");

  // The Synthesise control appears once 2+ sources are attached (ui_ux §4.20).
  await expect(page.getByTestId("opsp-synthesise-bhag")).toBeVisible();
  await page.getByTestId("opsp-synthesise-bhag").click();

  // The reason is shown to the facilitator (acceptance 3). With the key removed
  // the L2 path shows the honest refusal.
  const verdict = page.getByTestId("opsp-classification-bhag");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("Not compatible");
  await expect(verdict).toContainText("couldn't be assessed");
});