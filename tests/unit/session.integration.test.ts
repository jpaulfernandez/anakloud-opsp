import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { createSessionToken, parseSessionToken, resolveSession } from "../../lib/session";

// F02-T02 session resolution against a real Postgres. Runs only when opted in
// (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests. resolveSession is called directly (it is a pure-ish DB function), so
// the temporary schema's search_path applies. respondents/cohorts are not
// RLS-gated, so these queries run directly.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111111";
const RO = "aaaa1111-aaaa-1111-aaaa-111111111112";

describe.skipIf(!enabled)("session resolution against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret";

    db = createDbClient();
    await db.connect();
    schemaName = `session_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Open', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'S', 'session-token', 'ABCDEF', false)`,
      [RO, COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("resolves a valid session for an open cohort with readOnly false", async () => {
    const token = createSessionToken({ respondentId: RO, cohortId: COHORT });
    const resolved = await resolveSession(db!, token);
    expect(resolved).toEqual({
      respondentId: RO,
      cohortId: COHORT,
      isFacilitator: false,
      readOnly: false,
    });
  });

  it("a signed session survives a cohort closing — admitted read-only, not refused", async () => {
    await db!.query("update cohorts set status = 'closed' where id = $1", [COHORT]);

    const token = createSessionToken({ respondentId: RO, cohortId: COHORT });
    const resolved = await resolveSession(db!, token);
    // The session is still admitted; only readOnly flips. F02-T02: a cohort
    // closing mid-questionnaire must not lock the respondent out.
    expect(resolved).not.toBeNull();
    expect(resolved!.readOnly).toBe(true);
    expect(resolved!.respondentId).toBe(RO);
  });

  it("a forged cookie fails signature verification and resolves to null", async () => {
    // Build something that parses but was never signed.
    const signed = createSessionToken({ respondentId: RO, cohortId: COHORT });
    const [body] = signed.split(".");
    const forged = `${body}.not-a-real-signature`;
    expect(parseSessionToken(forged)).toBeNull();
    expect(await resolveSession(db!, forged)).toBeNull();
  });

  it("a well-signed token for an unknown respondent resolves to null", async () => {
    const token = createSessionToken({
      respondentId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      cohortId: COHORT,
    });
    expect(parseSessionToken(token)).not.toBeNull();
    expect(await resolveSession(db!, token)).toBeNull();
  });
});