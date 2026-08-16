import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F02-T06 end to end: the session middleware is the single gate, and it fails
// closed. A protected API route returns 401 for a missing cookie and for a
// forged cookie (whose signature fails HMAC verification in resolveSession);
// is_facilitator cannot be set from a request header, body or query parameter —
// the server reads it from the respondents row and the cookie carries no role
// field at all; and a protected page route with no session redirects to the
// claim screen. Live against a real Postgres because resolution reads the
// respondents row — so it SKIPS unless DATABASE_URL and SESSION_SECRET are
// present (the same opt-in as the other e2e tests).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RO = randomUUID();
const TOKEN = `middleware-e2e-${run}`;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Middleware', 'Q4 2026', 'open')",
    [COHORT],
  );
  // A blank display name and is_facilitator=false, so the name-entry submit can
  // succeed and no role is granted.
  await db.query(
    `insert into respondents (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, '', $3, 'MIDDL', false)`,
    [RO, COHORT, TOKEN],
  );
});

test.afterAll(async () => {
  if (db) {
    await db.query("delete from respondents where id = $1", [RO]).catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

function sessionHeader(): string {
  const token = createSessionToken({ respondentId: RO, cohortId: COHORT });
  return `${SESSION_COOKIE}=${token}`;
}

test("a protected API route returns 401 with no session cookie", async ({
  request,
}) => {
  const response = await request.patch("/api/respondent/self", {
    data: { name: "No Session" },
  });
  expect(response.status()).toBe(401);
});

test("a forged cookie fails signature verification and yields 401", async ({
  request,
}) => {
  // A value that is present but not a valid HMAC over the secret: resolveSession
  // rejects it exactly as if no cookie had been sent.
  const forged = `${SESSION_COOKIE}=garbage-that-parses-as-nothing-valid`;
  const response = await request.patch("/api/respondent/self", {
    headers: { cookie: forged },
    data: { name: "Forged" },
  });
  expect(response.status()).toBe(401);
});

test("a tampered but signed-looking cookie also yields 401", async ({ request }) => {
  // Take a genuinely-signed cookie and corrupt the signature byte — the HMAC
  // check must catch the difference.
  const [body] = sessionHeader().split("=")[1].split(".");
  const tampered = `${SESSION_COOKIE}=${body}.not-the-real-signature`;
  const response = await request.patch("/api/respondent/self", {
    headers: { cookie: tampered },
    data: { name: "Tampered" },
  });
  expect(response.status()).toBe(401);
});

test("a valid session cookie lets a protected API route through", async ({
  request,
}) => {
  const response = await request.patch("/api/respondent/self", {
    headers: { cookie: sessionHeader() },
    data: { name: "Real Person" },
  });
  expect(response.status()).toBe(200);
});

test("is_facilitator cannot be set from a request header, body or query parameter", async ({
  request,
}) => {
  // Fire the protected route with an is_facilitator claim in every place a
  // client could send one. The middleware reads identity only from the cookie
  // and the flag from the respondents row, so all three are ignored.
  const response = await request.patch(
    "/api/respondent/self?is_facilitator=true",
    {
      headers: {
        cookie: sessionHeader(),
        "x-is-facilitator": "true",
        "x-user-role": "facilitator",
      },
      data: { name: "Elevation Attempt", is_facilitator: true },
    },
  );
  expect(response.status()).toBe(200);

  const row = await db!.query(
    "select is_facilitator from respondents where id = $1",
    [RO],
  );
  expect(row.rows[0].is_facilitator).toBe(false);
});

test("a protected page route with no session redirects to the claim screen", async ({
  page,
}) => {
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/$/);
});