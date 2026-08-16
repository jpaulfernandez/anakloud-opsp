import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { SESSION_COOKIE } from "../../lib/session";

// F02-T02 end to end: an invite link exchanged for an httpOnly, SameSite=Lax
// cookie, landing on a token-free URL. Live against a real Postgres because a
// claim needs a genuinely valid token to resolve — so it SKIPS unless
// DATABASE_URL and SESSION_SECRET are both present (the same opt-in the DB
// integration tests use). The webServer (`next dev`) and this test share the
// parent environment, so the server's claim route resolves rows the test
// inserts into the default schema and tears down afterwards.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RO = randomUUID();
const TOKEN = `claim-e2e-${run}`;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Claim', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'E2E Claimant', $3, 'ABCDEF', false)`,
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

test("claiming an invite exchanges it for a cookie and redirects off the token", async ({
  page,
  context,
}) => {
  await page.goto(`/claim?token=${TOKEN}`);

  // The redirect target (the app home) carries no token.
  await expect(page).toHaveURL(/\/(\?.*)?$/);

  const cookies = await context.cookies();
  const session = cookies.find((c) => c.name === SESSION_COOKIE);
  expect(session, "a session cookie should be set").toBeDefined();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
  expect(session!.path).toBe("/");
});

test("an unknown token lands on the neutral invalid screen and sets no session", async ({
  page,
  context,
}) => {
  await page.goto(`/claim?token=definitely-not-a-real-token`);
  await expect(page).toHaveURL(/\/claim\/invalid$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "This link isn't valid any more." }),
  ).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
});