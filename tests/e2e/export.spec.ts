import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F10-T05 end to end: GET /api/admin/export against a real Postgres, on the
// same opt-in as the other DB-gated e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's three acceptances at the
// HTTP layer:
//
//   1. The default export contains no Q14(d) content — the private note is
//      never in the CSV body, even to the facilitator.
//   2. A request that asks for private rows WITHOUT the explicit re-confirmation
//      still gets a safe public export (no note, nothing logged).
//   3. The confirmed private export (`includePrivate=true&confirmPrivate=true`)
//      includes the note and records the release in `export_events`.
//
// The CSV serialization itself (escaping, multi-line/Taglish round trips) is
// covered by the pure tests in tests/unit/csv.test.ts and export.test.ts.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const ANA = randomUUID();

const ANA_NAME = "Ana Reyes";
const PRIVATE_NOTE = "I may need to step back after March.";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Export', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A submitted facilitator (F09-T01) admits them to the admin area.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', $3, 'EXPFC', true, now())`,
    [FACILITATOR, COHORT, `exp-fac-${COHORT}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, $3, $4, $5, false)`,
    [ANA, COHORT, ANA_NAME, `exp-ana-${COHORT}`, "EXPA1"],
  );

  // Ana answers q1 (open text) and q14 with a private note; the note must stay
  // off the default export and only appear on the re-confirmed private one.
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, { respondent_id: ANA, question_id: "q1", value: { text: "Para sa mga bata." } }),
  );
  await withRespondentContext(db!, ANA, (tx) =>
    upsertAnswer(tx, {
      respondent_id: ANA,
      question_id: "q14",
      value: {
        wants: ["product"],
        others: {},
        hours: 30,
        private_note: PRIVATE_NOTE,
      },
    }),
  );
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

function authHeaders() {
  const token = createSessionToken({ respondentId: FACILITATOR, cohortId: COHORT });
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

test("the default export contains no Q14(d) content", async ({ request }) => {
  const res = await request.get("/api/admin/export", { headers: authHeaders() });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/csv");

  const csv = await res.text();
  expect(csv).not.toContain(PRIVATE_NOTE);
  expect(csv).toContain(ANA_NAME);
  expect(csv).toContain("q14 confidence");
  expect(csv).toContain("q14 divergence");

  // No release was recorded for a plain public export.
  const { rows } = await db!.query(
    "select id from export_events where cohort_id = $1",
    [COHORT],
  );
  expect(rows).toHaveLength(0);
});

test("includePrivate without the explicit confirmation degrades to a safe public export", async ({
  request,
}) => {
  const res = await request.get("/api/admin/export?includePrivate=true", {
    headers: authHeaders(),
  });
  expect(res.status()).toBe(200);
  const csv = await res.text();
  // The note is not released without the confirmation.
  expect(csv).not.toContain(PRIVATE_NOTE);

  const { rows } = await db!.query(
    "select id from export_events where cohort_id = $1",
    [COHORT],
  );
  expect(rows).toHaveLength(0);
});

test("the confirmed private export includes Q14(d) and records the release", async ({
  request,
}) => {
  const res = await request.get(
    "/api/admin/export?includePrivate=true&confirmPrivate=true",
    { headers: authHeaders() },
  );
  expect(res.status()).toBe(200);
  const csv = await res.text();
  expect(csv).toContain(PRIVATE_NOTE);

  const { rows } = await db!.query(
    "select acted_by, included_private from export_events where cohort_id = $1",
    [COHORT],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].acted_by).toBe(FACILITATOR);
  expect(rows[0].included_private).toBe(true);
});