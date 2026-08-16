import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { SESSION_COOKIE } from "../../lib/session";

// F02-T03 end to end: claiming with a resume code restores the session, and
// the 6th attempt from one IP within an hour is rejected. Live against a real
// Postgres because a claim needs a real code and a rate-limit ledger to resolve
// — so it SKIPS unless DATABASE_URL and SESSION_SECRET are present (the same
// opt-in as the other e2e/integration tests). Each test uses its own IP and its
// own respondent so parallel runs and the shared ledger never count each
// other's attempts.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RO = randomUUID();
// Unique per run so the shared, per-IP ledger never bleeds between test runs.
const RESTORE_IP = `192.0.2.${parseInt(run, 16) % 254 + 1}`;
const BRUTEFORCE_IP = `192.0.2.${parseInt(run, 16) % 254 + 200}`;
const CODE = "ABCDEF";

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Resume', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'E2E Resumer', $3, $4, false)`,
    [RO, COHORT, `resume-e2e-${run}`, CODE],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from resume_code_attempts where ip in ($1, $2)", [
      RESTORE_IP,
      BRUTEFORCE_IP,
    ]).catch(() => {});
    await db.query("delete from respondents where id = $1", [RO]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

test("lower-case entry of an upper-case code restores the session", async ({
  request,
}) => {
  const response = await request.post("/api/session/claim", {
    data: { resumeCode: CODE.toLowerCase() },
    headers: { "x-forwarded-for": RESTORE_IP },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { ok?: boolean; redirectTo?: string };
  expect(body.ok).toBe(true);
  expect(body.redirectTo).toBe("/");
  expect(response.headers()["set-cookie"]).toContain(SESSION_COOKIE);
});

test("the 6th resume-code attempt from one IP within an hour is rejected", async ({
  request,
}) => {
  // Five well-formed-but-unknown codes from the same IP: each is allowed to
  // fail (ok: false, not rate limited), and every one is recorded.
  for (let i = 0; i < 5; i++) {
    const response = await request.post("/api/session/claim", {
      data: { resumeCode: "ZZZZZZ" },
      headers: { "x-forwarded-for": BRUTEFORCE_IP },
    });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { ok?: boolean };
    expect(body.ok).toBe(false);
  }

  // The 6th within the hour is refused with 429 and no session cookie.
  const sixth = await request.post("/api/session/claim", {
    data: { resumeCode: CODE },
    headers: { "x-forwarded-for": BRUTEFORCE_IP },
  });
  expect(sixth.status()).toBe(429);
  const body = (await sixth.json()) as { ok?: boolean; rateLimited?: boolean };
  expect(body.ok).toBe(false);
  expect(body.rateLimited).toBe(true);
  expect(sixth.headers()["set-cookie"] ?? "").not.toContain(SESSION_COOKIE);

  // Even the correct code is refused for the remainder of the hour, and a
  // second attacker IP is unaffected.
  const bystander = await request.post("/api/session/claim", {
    data: { resumeCode: CODE },
    headers: { "x-forwarded-for": `192.0.2.${parseInt(run, 16) % 254 + 100}` },
  });
  expect(bystander.status()).toBe(200);
});