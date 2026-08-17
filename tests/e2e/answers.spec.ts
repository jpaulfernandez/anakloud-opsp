import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { withRespondentContext } from "../../lib/access";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F04-T01 end to end: the answer persistence API. PATCH /api/answers upserts
// exactly one row keyed on (respondent_id, question_id) for the session's own
// respondent, rejects a wrong-shaped payload with 400, refuses a write after
// submit with 409 (leaving the row untouched), never accepts a respondent_id
// supplied by the client, and GET /api/answers returns all of the caller's own
// answers including their own q14d.
//
// Live against a real Postgres because persistence and lock state read rows it
// must seed — so it SKIPS unless DATABASE_URL and SESSION_SECRET are present,
// the same opt-in as the other e2e tests. Runs fully-parallel (playwright
// config), so each test drives its own dedicated respondent; no test reads
// another's side effects. Reads of the gated answers table go through the
// facilitator respondent's RLS context, exactly as the integration tests do.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();

// One respondent per test, so fully-parallel workers never collide.
const R = {
  upsert: randomUUID(),
  lockMid: randomUUID(),
  submitted: randomUUID(),
  shape: randomUUID(),
  spoof: randomUUID(),
  victim: randomUUID(),
  getOwn: randomUUID(),
} as const;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Answers', 'Q4 2026', 'open')",
    [COHORT],
  );

  // submitted is locked from birth; every other respondent is unlocked.
  const insert = async (
    id: string,
    tag: string,
    code: string,
    submitted: boolean,
  ) => {
    const cols = ["id", "cohort_id", "display_name", "invite_token", "resume_code", "is_facilitator"];
    const vals = ["$1", "$2", "'Person'", "$3", "$4", "false"];
    if (submitted) {
      cols.push("submitted_at");
      vals.push("now()");
    }
    await db!.query(
      `insert into respondents (${cols.join(", ")}) values (${vals.join(", ")})`,
      [id, COHORT, `ans-${tag}-${run}`, code],
    );
  };
  await insert(R.upsert, "upsert", "ABRQST", false);
  await insert(R.lockMid, "lockmid", "LOCKMD", false);
  await insert(R.submitted, "submitted", "SUBMIT", true);
  await insert(R.shape, "shape", "SHAPEX", false);
  await insert(R.spoof, "spoof", "SPOOFY", false);
  await insert(R.victim, "victim", "VICTMS", false);
  await insert(R.getOwn, "getown", "GETOWN", false);

  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Facilitator', $3, 'FACANS', true)`,
    [FACILITATOR, COHORT, `ans-fac-${run}`],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where cohort_id = $1", [COHORT]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

function sessionHeader(respondentId: string): Record<string, string> {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  return { cookie: `${SESSION_COOKIE}=${token}` };
}

/** Read one respondent's answers as the cohort facilitator, bypassing RLS. */
async function facilitatorRows(respondentId: string) {
  let rows: Array<{ question_id: string; value: unknown; confidence: number | null }> = [];
  await withRespondentContext(db!, FACILITATOR, async (tx) => {
    const res = await tx.query(
      "select question_id, value, confidence from answers where respondent_id = $1 order by question_id",
      [respondentId],
    );
    rows = res.rows;
  });
  return rows;
}

test("a protected route returns 401 with no session cookie", async ({ request }) => {
  const response = await request.patch("/api/answers", {
    data: { question_id: "q7", value: { text: "x" } },
  });
  expect(response.status()).toBe(401);
});

test("PATCH upserts exactly one row keyed on (respondent, question)", async ({
  request,
}) => {
  const headers = sessionHeader(R.upsert);

  const first = await request.patch("/api/answers", {
    headers,
    data: { question_id: "q7", value: { text: "one priority" }, confidence: 4 },
  });
  expect(first.status()).toBe(200);

  // Updating the same question again stays a single row, with the new value —
  // the unique (respondent_id, question_id) upsert, not an insert.
  const second = await request.patch("/api/answers", {
    headers,
    data: { question_id: "q7", value: { text: "the one promise" }, confidence: 4 },
  });
  expect(second.status()).toBe(200);

  const rows = await facilitatorRows(R.upsert);
  const q7 = rows.filter((r) => r.question_id === "q7");
  expect(q7).toHaveLength(1);
  expect(q7[0].value).toEqual({ text: "the one promise" });
  expect(q7[0].confidence).toBe(4); // retained across the upsert
});

test("a write after submit returns 409 and leaves the row byte-identical", async ({
  request,
}) => {
  // Write an answer, lock the respondent as submit would, then try to change
  // it: the write must be refused and the row must stay untouched.
  await request.patch("/api/answers", {
    headers: sessionHeader(R.lockMid),
    data: { question_id: "q4", value: { text: "original" } },
  });
  await db!.query("update respondents set submitted_at = now() where id = $1", [
    R.lockMid,
  ]);

  const attempt = await request.patch("/api/answers", {
    headers: sessionHeader(R.lockMid),
    data: { question_id: "q4", value: { text: "changed after lock" } },
  });
  expect(attempt.status()).toBe(409);

  const rows = await facilitatorRows(R.lockMid);
  const q4 = rows.find((r) => r.question_id === "q4");
  expect(q4?.value).toEqual({ text: "original" });
});

test("a submitted respondent cannot write at all", async ({ request }) => {
  const before = await facilitatorRows(R.submitted);
  expect(before.some((r) => r.question_id === "q1")).toBe(false);

  const response = await request.patch("/api/answers", {
    headers: sessionHeader(R.submitted),
    data: { question_id: "q1", value: { text: "nope — already locked" } },
  });
  expect(response.status()).toBe(409);

  const after = await facilitatorRows(R.submitted);
  expect(after.some((r) => r.question_id === "q1")).toBe(false);
});

test("a payload of the wrong shape is rejected with 400 and not written", async ({
  request,
}) => {
  const response = await request.patch("/api/answers", {
    headers: sessionHeader(R.shape),
    data: { question_id: "q7", value: { text: 123 } },
  });
  expect(response.status()).toBe(400);

  const rows = await facilitatorRows(R.shape);
  expect(rows.some((r) => r.question_id === "q7")).toBe(false);
});

test("a client-supplied respondent_id has no effect", async ({ request }) => {
  const response = await request.patch("/api/answers", {
    headers: sessionHeader(R.spoof),
    data: {
      question_id: "q9",
      value: { items: ["a", "b", "c"] },
      respondent_id: R.victim, // spoofed id — must be ignored
    },
  });
  expect(response.status()).toBe(200);

  const spoof = await facilitatorRows(R.spoof);
  const victim = await facilitatorRows(R.victim);
  expect(spoof.some((r) => r.question_id === "q9")).toBe(true);
  expect(victim.some((r) => r.question_id === "q9")).toBe(false);
});

test("GET returns all own answers including own q14d", async ({ request }) => {
  await request.patch("/api/answers", {
    headers: sessionHeader(R.getOwn),
    data: {
      question_id: "q14",
      value: {
        wants: ["product"],
        others: { [R.upsert]: "backend" },
        hours: 15,
        private_note: "I may need to step back.",
      },
    },
  });

  const response = await request.get("/api/answers", {
    headers: sessionHeader(R.getOwn),
  });
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.ok).toBe(true);

  const q14d = body.answers.find((a: { question_id: string }) => a.question_id === "q14d");
  expect(q14d).toBeDefined();
  expect(q14d.value).toEqual({ private_note: "I may need to step back." });

  // Every returned row belongs to the caller — only the rows written above.
  const ids = new Set(body.answers.map((a: { question_id: string }) => a.question_id));
  expect([...ids].sort()).toEqual(["q14", "q14d"]);
});