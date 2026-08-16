import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F10-T02 end to end: the comparison data endpoint against a real Postgres, on
// the same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's over-the-wire acceptances:
//
//   1. The anonymised response under inspection of the raw payload carries no
//      name, email or respondent id, and a divergence result is present.
//   2. Attributed mode (explicit `?mode=attributed`) is the only shape that
//      names someone.
//   3. q14d — and any unknown id — never returns a payload from this route.
//   4. The Q14(d) private note stays off every mode, even the facilitator's.
//   5. The F09-T01 admin gate holds: an unsubmitted facilitator is refused.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const UNSUB_FACILITATOR = randomUUID();
const ANA = randomUUID();
const BEN = randomUUID();

const ANA_NAME = "Ana Reyes";
const BEN_NAME = "Benito Cruz";
const ANA_EMAIL = "ana@anakloud.ph";
const BEN_EMAIL = "ben@anakloud.ph";
const PRIVATE_NOTE = "I may need to step back after March.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Comparison', 'Q4 2026', 'open')",
    [COHORT],
  );
  const respondent = (
    id: string,
    name: string,
    email: string,
    code: string,
    submitted: boolean,
    fac = false,
  ) =>
    db!.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        COHORT,
        name,
        email,
        `cmp-${code}-${run}`,
        code,
        fac,
        submitted ? new Date() : null,
      ],
    );
  // A submitted facilitator (admits them through F09-T01), an unsubmitted
  // facilitator (must be refused), and two respondents who stay unsubmitted so
  // their answers can be written (upsertAnswer refuses a submitted writer).
  await respondent(FACILITATOR, "Lia Mendoza", "lia@anakloud.ph", "CMF1", true, true);
  await respondent(UNSUB_FACILITATOR, "Unsubmitted Fac", "uf@anakloud.ph", "CMU1", false, true);
  await respondent(ANA, ANA_NAME, ANA_EMAIL, "CMA1", false);
  await respondent(BEN, BEN_NAME, BEN_EMAIL, "CMB1", false);

  const write = async (
    respondentId: string,
    questionId: string,
    value: object,
    confidence?: number,
  ) => {
    await withRespondentContext(db!, respondentId, (tx) =>
      upsertAnswer(tx, {
        respondent_id: respondentId,
        question_id: questionId,
        value,
        confidence: confidence ?? null,
      }),
    );
  };

  // Q3 closed + confidence with a real split.
  await write(ANA, "q3", { metric: "paying centers", value: 300, unit: "paying_centers", why: "a" }, 3);
  await write(BEN, "q3", { metric: "paying centers", value: 350, unit: "visits", why: "b" }, 2);
  // Q14 with a private note.
  await write(ANA, "q14", { wants: ["product"], others: { [BEN]: "backend" }, hours: 30, private_note: PRIVATE_NOTE });
  await write(BEN, "q14", { wants: ["backend"], others: { [ANA]: "product" }, hours: 20 });
});

test.afterAll(async () => {
  if (db) {
    await db
      .query("delete from respondents where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

function asAdmin(request: APIRequestContext, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  return request.get("/api/admin/question/q3", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

test("the anonymised response carries no name, email or respondent id", async ({ request }) => {
  const res = await asAdmin(request, FACILITATOR);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.questionId).toBe("q3");
  expect(body.mode).toBe("anonymised");
  expect(body.answers).toHaveLength(2);
  expect(body.divergence).toBeTruthy();
  expect(body.divergence.category).toBe("soft split");

  // Under inspection of the raw payload: true identity values present in the
  // rows fetched by the query never appear in the anonymised response.
  const raw = JSON.stringify(body);
  expect(raw).not.toContain(ANA_NAME);
  expect(raw).not.toContain(BEN_NAME);
  expect(raw).not.toContain(ANA_EMAIL);
  expect(raw).not.toContain(BEN_EMAIL);
  expect(raw).not.toContain(ANA);
  expect(raw).not.toContain(BEN);

  // Each answer card carries only the answer data.
  for (const a of body.answers) {
    expect(Object.keys(a).sort()).toEqual(["confidence", "value"]);
  }
});

test("attributed mode is the only shape that names someone", async ({ request }) => {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  const res = await request.get("/api/admin/question/q3?mode=attributed", {
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.mode).toBe("attributed");
  expect(JSON.stringify(body)).toContain(ANA_NAME);
  expect(JSON.stringify(body)).toContain(BEN_NAME);
});

test("q14d is never returned by this route", async ({ request }) => {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  for (const qid of ["q14d", "q99"]) {
    const res = await request.get(`/api/admin/question/${qid}`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status(), qid).toBe(404);
  }
});

test("the Q14(d) private note stays off every mode of this route", async ({ request }) => {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  for (const mode of ["", "?mode=attributed"]) {
    const res = await request.get(`/api/admin/question/q14${mode}`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(PRIVATE_NOTE);
    expect(body.answers).toHaveLength(2);
  }
});

test("an unsubmitted facilitator is refused with 403", async ({ request }) => {
  const res = await asAdmin(request, UNSUB_FACILITATOR);
  expect(res.status()).toBe(403);
});