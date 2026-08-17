import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { performSubmit } from "../../lib/submit";

// F14-T04 end to end — POST /api/admin/opsp-analysis, against a real Postgres
// (SKIP unless DATABASE_URL and SESSION_SECRET are present, like the other
// DB-gated specs). The ticket's access acceptances over the HTTP surface:
//
//   1. "A respondent cannot reach this analysis for their own OPSP by any
//      route" — a non-facilitator requesting the read of their own OPSP is
//      refused 403 by the admin gate before any draft is loaded.
//   2. The feature is facilitator-only — an unsubmitted facilitator is also
//      403, in line with the F09-T01 gate.
//   3. With the key removed (the L2 local default) a submitted facilitator gets
//      the deterministic structural read and a 200, labelled and marked as prep
//      material, never an error (PR3).
//   4. An owner with no OPSP draft is a 404, not an AI failure.
//
// The spec is serial within the file like the other DB suites, so module-scoped
// cohorts do not collide across parallel workers.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

const SUB = randomUUID(); // submitted facilitator → allowed
const UNSUB = randomUUID(); // facilitator, submitted=false → 403
const RESP = randomUUID(); // not a facilitator, wants their own OPSP → 403
const OWNER = randomUUID(); // submitted respondent with an OPSP draft → analysed
const PLAIN = randomUUID(); // unsubmitted respondent with no draft → 404

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Opsp Analysis', 'Q4 2026', 'open')",
    [COHORT],
  );

  for (const row of [
    { id: SUB, name: "Facilitator Opsp Analysis", token: "OPFA1", isFac: true, submitted: new Date() },
    { id: UNSUB, name: "Unsubmitted Facilitator", token: "OPFA2", isFac: true, submitted: null },
    { id: RESP, name: "Respondent Wants Own", token: "OPRW1", isFac: false, submitted: null },
    { id: OWNER, name: "Plan Owner", token: "OPOWN", isFac: false, submitted: null },
    { id: PLAIN, name: "No-Draft Respondent", token: "OPPLN", isFac: false, submitted: null },
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, COHORT, row.name, `an-${run}-${row.token}`, row.token, row.isFac, row.submitted],
    );
  }

  // The analysed owner answers a self-contradicting pair (parents vs centers)
  // and submits, which creates their OPSP draft v1 via the deterministic map.
  await withRespondentContext(db!, OWNER, async (tx) => {
    await upsertAnswer(tx, {
      respondent_id: OWNER,
      question_id: "q7",
      value: { text: "Parents are our customer; we make their lives better first." },
    });
    await upsertAnswer(tx, {
      respondent_id: OWNER,
      question_id: "q10",
      value: { payer: "center", model: "monthly_subscription", amount: 2500, unit: "per_center", first_peso: "2027-01" },
    });
  });
  await performSubmit(db!, OWNER, COHORT);
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
      await db.query("delete from answer_snapshots where respondent_id = any($1::uuid[])", [ids]);
      await db.query("delete from ai_interactions where respondent_id = any($1::uuid[])", [ids]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    await db.query("delete from respondents where cohort_id = $1", [COHORT]);
    await db.query("delete from cohorts where id = $1", [COHORT]);
    await db.end();
  }
});

/** The Cookie header that presents a session for the given respondent. */
function sessionCookie(respondentId: string, cohortId: string): string {
  const token = createSessionToken({ respondentId, cohortId });
  return `${SESSION_COOKIE}=${token}`;
}

test("a submitted facilitator gets the labelled structural read and a 200 (key removed)", async ({
  request,
}) => {
  const res = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { respondent_id: OWNER },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    level: string;
    ownerLabel: string;
    prepLabel: string;
    label: { model: string; generatedAt: string };
    deterministic: { draftVersion: number; filledCount: number; cells: Array<{ cells: never }> };
  };
  expect(body.ok).toBe(true);
  expect(body.level).toBe("L2");
  expect(body.ownerLabel).toBe("A");
  // Every output is labelled (FR-35) and marked as prep material (ui_ux §4.19).
  expect(body.label.generatedAt).toBeTruthy();
  expect(body.prepLabel).toBe("Prep material. Not a finding to show the team.");
  expect(body.deterministic.draftVersion).toBe(1);
  expect(body.deterministic.filledCount).toBeGreaterThan(0);
});

test("an owner with no OPSP draft is a 404, not an AI failure", async ({ request }) => {
  const res = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { respondent_id: PLAIN },
  });
  expect(res.status()).toBe(404);
});

test("a respondent cannot reach the analysis of their own OPSP (403)", async ({ request }) => {
  const res = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(RESP, COHORT) },
    data: { respondent_id: RESP },
  });
  expect(res.status()).toBe(403);
});

test("an unsubmitted facilitator cannot call it (403)", async ({ request }) => {
  const res = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(UNSUB, COHORT) },
    data: { respondent_id: OWNER },
  });
  expect(res.status()).toBe(403);
});

test("a missing or empty respondent_id is a 400", async ({ request }) => {
  const missing = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: {},
  });
  expect(missing.status()).toBe(400);

  const empty = await request.post("/api/admin/opsp-analysis", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { respondent_id: "" },
  });
  expect(empty.status()).toBe(400);
});