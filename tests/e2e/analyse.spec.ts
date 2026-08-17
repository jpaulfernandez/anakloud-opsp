import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F14-T02 end to end — POST /api/admin/analyse with its degradation, against a
// real Postgres (SKIP unless DATABASE_URL and SESSION_SECRET are present, like
// the other DB-gated specs). The ticket's acceptances over the HTTP surface:
//
//   1. "With the key removed, the endpoint returns scoring data and a 200."
//      The dev server defaults to L2 (AGENTS.md pins local/preview to L2), so
//      an analyse request serves the deterministic divergence scoring — the
//      same branch the removed-key case lands on — and never an error.
//   2. At a cohort pinned to L1 the endpoint returns a queued response (the
//      background retry completing without user action is unit-tested in
//      analysis-queue.test.ts / analyse-endpoint.test.ts).
//   3. "An unsubmitted facilitator cannot call it" — the admin gate refuses an
//      unsubmitted facilitator and a non-facilitator with 403.
//
// The spec is serial within the file (one worker, one beforeAll) because the
// DB-gated suites share module-scoped cohorts and must not collide across
// parallel workers (fullyParallel per-file beforeAll).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const run = randomBytes(4).toString("hex");
// The submitted-facilitator cohort, served at the L2 default (key-removal case).
const COHORT = randomUUID();
// A cohort pinned to L1, to assert the queued response.
const COHORT_L1 = randomUUID();

const SUB = randomUUID(); // submitted facilitator → allowed
const UNSUB = randomUUID(); // submitted=false → 403
const RESP = randomUUID(); // not a facilitator → 403
const SUB_L1 = randomUUID(); // submitted facilitator on the L1 cohort
// Unsubmitted answer-providers whose Q8 split the scoring reports.
const RSP1 = randomUUID();
const RSP2 = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Analyse', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    "insert into cohorts (id, name, quarter_label, status, ai_level_pin) values ($1, 'E2E Analyse L1', 'Q4 2026', 'open', 'L1')",
    [COHORT_L1],
  );

  for (const row of [
    { id: SUB, cohort: COHORT, name: "Facilitator Analyse", token: "ANLZ2", isFac: true, submitted: new Date() },
    { id: UNSUB, cohort: COHORT, name: "Unsubmitted Facilitator", token: "ANLZU", isFac: true, submitted: null },
    { id: RESP, cohort: COHORT, name: "Respondent Analyse", token: "ANLZR", isFac: false, submitted: null },
    { id: RSP1, cohort: COHORT, name: "Answerer One", token: "ANLA1", isFac: false, submitted: null },
    { id: RSP2, cohort: COHORT, name: "Answerer Two", token: "ANLA2", isFac: false, submitted: null },
    { id: SUB_L1, cohort: COHORT_L1, name: "Facilitator Analyse L1", token: "ANLZL", isFac: true, submitted: new Date() },
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, row.cohort, row.name, `an-${run}-${row.token}`, row.token, row.isFac, row.submitted],
    );
  }

  // Two respondents with an opposite Q8 ranking so the deterministic scoring
  // has a genuine split to report for the submitted facilitator's cohort.
  const responder = async (id: string, seed: number) => {
    await withRespondentContext(db!, id, async (tx) => {
      await upsertAnswer(tx, {
        respondent_id: id,
        question_id: "q8",
        value: {
          rank:
            seed === 1
              ? ["pedconnect", "teachday", "parentup", "fourth_app"]
              : ["teachday", "pedconnect", "parentup", "fourth_app"],
          delete: "fourth_app",
          why: `reason ${seed}`,
          predicted: ["teachday", "pedconnect", "parentup", "fourth_app"],
        },
        confidence: 5,
      });
    });
  };
  await responder(RSP1, 1);
  await responder(RSP2, 2);
});

test.afterAll(async () => {
  if (db) {
    const { rows } = await db.query<{ id: string }>(
      "select id from respondents where cohort_id = any($1::uuid[])",
      [[COHORT, COHORT_L1]],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.query("delete from ai_interactions where respondent_id = any($1::uuid[])", [ids]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    // F14-T06 — the analyse route retains outputs keyed by cohort, so clear
    // them before the cohort drops (FK) and before any trial that asserts on
    // retained history counts for this cohort.
    await db.query(
      "delete from analysis_outputs where cohort_id = any($1::uuid[])",
      [[COHORT, COHORT_L1]],
    );
    await db.query("delete from respondents where cohort_id = any($1::uuid[])", [[COHORT, COHORT_L1]]);
    await db.query("delete from cohorts where id = any($1::uuid[])", [[COHORT, COHORT_L1]]);
    await db.end();
  }
});

/** The Cookie header that presents a session for the given respondent. */
function sessionCookie(respondentId: string, cohortId: string): string {
  const token = createSessionToken({ respondentId, cohortId });
  return `${SESSION_COOKIE}=${token}`;
}

test("a submitted facilitator gets deterministic scoring data and a 200 (key removed)", async ({
  request,
}) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: {},
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    level: string;
    scope: string;
    scoring: { results: Array<{ questionId: string; category: string | null }> };
  };
  expect(body.ok).toBe(true);
  expect(body.level).toBe("L2");
  expect(body.scope).toBe("cohort");
  expect(body.scoring.results.length).toBeGreaterThan(0);
  // The deterministic verdict on the sharp Q8 split is present.
  const q8 = body.scoring.results.find((r) => r.questionId === "q8");
  expect(q8?.category).toBe("hard split");
});

test("a single-question analyse request returns scoring for that question", async ({
  request,
}) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { question_id: "q8" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    scope: string;
    questionId: string;
    scoring: { results: Array<{ questionId: string }> };
  };
  expect(body.ok).toBe(true);
  expect(body.scope).toBe("question");
  expect(body.questionId).toBe("q8");
  expect(body.scoring.results).toHaveLength(1);
  expect(body.scoring.results[0].questionId).toBe("q8");
});

test("re-running retains the prior output, each with its serving level (F14-T06)", async ({
  request,
}) => {
  // Two cohort-scope serves on the same cohort; the second must return a
  // retained history that includes the first, newest last, with the serving
  // level recorded on every output (FR-35). This asserts the durable store the
  // route writes to, not a client-side append.
  const first = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { question_id: "q8" },
  });
  expect(first.status()).toBe(200);
  const firstBody = (await first.json()) as { level: string };

  const second = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { question_id: "q8" },
  });
  expect(second.status()).toBe(200);
  const body = (await second.json()) as {
    level: string;
    history: Array<{ level: string; ok: boolean }>;
  };
  expect(body.history.length).toBeGreaterThanOrEqual(2);
  // The fresh serve rides last; every retained output records its level.
  expect(body.history[body.history.length - 1].ok).toBe(true);
  for (const output of body.history) {
    expect(output.level).toBe(firstBody.level);
  }
});

test("a cohort pinned to L1 returns a queued plus deterministic response", async ({
  request,
}) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB_L1, COHORT_L1) },
    data: {},
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; level: string; queued?: boolean };
  expect(body.ok).toBe(true);
  expect(body.level).toBe("L1");
  expect(body.queued).toBe(true);
});

test("an invalid question id is a 400, not a 5xx", async ({ request }) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(SUB, COHORT) },
    data: { question_id: "q99" },
  });
  expect(res.status()).toBe(400);
});

test("an unsubmitted facilitator cannot call it (403)", async ({ request }) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(UNSUB, COHORT) },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test("a non-facilitator cannot call it (403)", async ({ request }) => {
  const res = await request.post("/api/admin/analyse", {
    headers: { cookie: sessionCookie(RESP, COHORT) },
    data: {},
  });
  expect(res.status()).toBe(403);
});