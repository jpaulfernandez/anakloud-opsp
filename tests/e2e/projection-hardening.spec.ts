import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";
import { ATTRIBUTE_GRANT_HEADER } from "../../lib/attribute-grant";

// F14-T05 — anonymised projection hardening (FR-30, spec.md §10 criterion 12,
// ui_ux.md §4.18) against a real Postgres, on the same opt-in as the other
// DB-gated e2e specs (SKIP unless DATABASE_URL and SESSION_SECRET are present).
//
// The ticket's three acceptances, exercised over the actual HTTP surface — this
// is a hardening ticket, so the tests prove the *server* will not hand out
// names in the ways the ticket forbids, not just that the UI hides them:
//
//   1. "Attributed mode is unreachable by URL manipulation alone" — a bare
//      `?mode=attributed` on the comparison GET serves only the anonymised
//      payload; names appear only after the confirmation flow has minted a
//      server-issued attribute grant and the client sends it over the header.
//      A grant is scoped to one question, so a q1 grant does not authorise q3.
//   2. "Names are absent from the network payload in anonymised mode" — the
//      default comparison GET (the one every anonymised load makes) contains
//      no name, email or respondent id, verifiable by inspecting the raw bytes.
//   3. "Analysis output in anonymised mode uses A/B/C labels only" — the
//      analyse endpoint, run from the anonymised comparison surface, returns
//      output free of every identity in the seeded cohort (the A/B/C labelling
//      of the payload itself is asserted in the F14-T01 integration suite; this
//      locks the HTTP contract).
//
// The spec is serial within the file (one worker, one beforeAll) because the
// DB-gated suites share module-scoped cohorts and must not collide across
// parallel workers.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const R1 = randomUUID();
const R2 = randomUUID();

const R1_NAME = "Alfonso Cruz";
const R1_EMAIL = "alfonso@example.ph";
const R2_NAME = "Bianca Delgado";
const R2_EMAIL = "bianca@example.ph";
const IDENTITIES = [R1_NAME, R2_NAME, R1_EMAIL, R2_EMAIL, R1, R2];

const R1_Q1 = { text: "Parents wait months to find out whether their child is delayed." };
const R2_Q1 = { text: "Therapy notes live in six notebooks nobody can read quickly." };

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Projection Hardening', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', 'lia@example.ph', $3, 'PHARDF1', true, now())`,
    [FACILITATOR, COHORT, `phard-fac-${COHORT}`],
  );
  for (const [id, name, email, code] of [
    [R1, R1_NAME, R1_EMAIL, "PHARDA1"],
    [R2, R2_NAME, R2_EMAIL, "PHARDB1"],
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, $6, false)`,
      [id, COHORT, name, email, `phard-${COHORT}-${code}`, code],
    );
  }

  // Q1 open text for both, so the comparison and the analysis each have answers.
  await withRespondentContext(db!, R1, (tx) =>
    upsertAnswer(tx, { respondent_id: R1, question_id: "q1", value: R1_Q1 }),
  );
  await withRespondentContext(db!, R2, (tx) =>
    upsertAnswer(tx, { respondent_id: R2, question_id: "q1", value: R2_Q1 }),
  );
});

test.afterAll(async () => {
  if (db) {
    const { rows } = await db.query<{ id: string }>(
      "select id from respondents where cohort_id = $1",
      [COHORT],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.query("delete from ai_interactions where respondent_id = any($1::uuid[])", [ids]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    // F14-T06 — the analyse route retains outputs keyed by cohort; clear them
    // before the cohort drops (FK).
    await db.query("delete from analysis_outputs where cohort_id = $1", [COHORT]);
    await db.query("delete from respondents where cohort_id = $1", [COHORT]);
    await db.query("delete from cohorts where id = $1", [COHORT]);
    await db.end();
  }
});

/** The Cookie header that presents the facilitator's session. */
function facilitatorCookie(): string {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  return `${SESSION_COOKIE}=${token}`;
}

/** Assert no identity value leaks anywhere in a serialised API payload. */
function expectNoIdentity(payload: unknown) {
  const raw = JSON.stringify(payload);
  for (const secret of IDENTITIES) {
    expect(raw, `identity leaked: ${secret}`).not.toContain(secret);
  }
}

test("attributed mode is unreachable by URL manipulation alone", async ({
  request,
}) => {
  // A bare query string — the only thing URL manipulation can produce — must
  // not serve names. The route fails the (absent) grant and serves anonymised.
  const res = await request.get("/api/admin/question/q1?mode=attributed", {
    headers: { cookie: facilitatorCookie() },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; mode: string; answers: unknown[] };
  expect(body.ok).toBe(true);
  expect(body.mode).toBe("anonymised");
  expect(body.answers).toHaveLength(2);
  expectNoIdentity(body);
  // The anonymised card shape carries only value + confidence.
  for (const a of body.answers as Array<Record<string, unknown>>) {
    expect(Object.keys(a).sort()).toEqual(["confidence", "value"]);
  }
});

test("a garbage grant over the header does not serve names either", async ({
  request,
}) => {
  const res = await request.get("/api/admin/question/q1?mode=attributed", {
    headers: { cookie: facilitatorCookie(), [ATTRIBUTE_GRANT_HEADER]: "not-a-real-grant" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { mode: string };
  expect(body.mode).toBe("anonymised");
  expectNoIdentity(body);
});

test("names are absent from the anonymised network payload", async ({
  request,
}) => {
  // The default comparison GET is the request every anonymised load makes;
  // its raw payload must carry no identity at all (F14-T05 acceptance 2).
  const res = await request.get("/api/admin/question/q1", {
    headers: { cookie: facilitatorCookie() },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    mode: string;
    answers: unknown[];
  };
  expect(body.mode).toBe("anonymised");
  expect(body.answers).toHaveLength(2);
  expectNoIdentity(body);
});

test("attributed names appear only through a valid grant, scoped to one question", async ({
  request,
}) => {
  // The confirmation flow mints a grant for q1…
  const g = await request.post("/api/admin/question/q1/attribute-grant", {
    headers: { cookie: facilitatorCookie() },
  });
  expect(g.status()).toBe(200);
  const grantBody = (await g.json()) as { ok: boolean; grant: string };
  expect(grantBody.ok).toBe(true);
  expect(typeof grantBody.grant).toBe("string");
  expect(grantBody.grant.length).toBeGreaterThan(0);

  // …and with that grant over the header, the named payload is served. This is
  // the proof the URL-alone test is meaningful: names DO flow, but only through
  // the confirmation-then-grant path.
  const attributed = await request.get("/api/admin/question/q1?mode=attributed", {
    headers: { cookie: facilitatorCookie(), [ATTRIBUTE_GRANT_HEADER]: grantBody.grant },
  });
  expect(attributed.status()).toBe(200);
  const named = (await attributed.json()) as {
    ok: boolean;
    mode: string;
    answers: Array<{ name: string; email: string | null; respondentId: string }>;
  };
  expect(named.mode).toBe("attributed");
  expect(named.answers).toHaveLength(2);
  const names = named.answers.map((a) => a.name);
  expect(names).toEqual(expect.arrayContaining([R1_NAME, R2_NAME]));

  // A grant is scoped to one question: the same q1 grant must not authorise the
  // named payload for q3. It fails scope → anonymised.
  const otherQuestion = await request.get("/api/admin/question/q3?mode=attributed", {
    headers: { cookie: facilitatorCookie(), [ATTRIBUTE_GRANT_HEADER]: grantBody.grant },
  });
  expect(otherQuestion.status()).toBe(200);
  const crossNamed = (await otherQuestion.json()) as { mode: string };
  expect(crossNamed.mode).toBe("anonymised");
  expectNoIdentity(crossNamed);
});

test("the analysis run from anonymised mode carries no names", async ({
  request,
}) => {
  // The analyse endpoint is what the anonymised comparison panel fires; at the
  // key-removed/L2 default it serves the deterministic scoring. Whichever
  // branch, its output must be free of every identity in the cohort (F14-T05
  // acceptance 3 — the A/B/C payload labelling itself is asserted in the F14-T01
  // integration suite).
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: facilitatorCookie() },
    data: { question_id: "q1" },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expectNoIdentity(body);
  expect(JSON.stringify(body)).toContain("results");
});