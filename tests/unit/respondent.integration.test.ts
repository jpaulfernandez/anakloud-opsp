import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  claimDestination,
  groundRulesAcknowledged,
  setGroundRulesAcknowledged,
  setRespondentName,
} from "../../lib/respondent";

// F02-T04 / F02-T05 onboarding state against a real Postgres. Runs only when
// opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests, calling the lib functions directly. respondents/cohorts are not
// RLS-gated, so these queries run directly.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111121";
const RO = "aaaa1111-aaaa-1111-aaaa-111111111122";

describe.skipIf(!enabled)("respondent onboarding against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `respondent_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    // A respondent created with a blank display name: they have not been
    // through name entry yet, so a claim should land them there.
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Open', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, '', 'respondent-token', 'ABCDEF', false)`,
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

  it("a blank display name means first run — claimDestination is /welcome", async () => {
    expect(await claimDestination(db!, RO)).toBe("/welcome");
  });

  it("setRespondentName persists the name and optional email, and clearing email stores null", async () => {
    await setRespondentName(db!, RO, "  Ana Reyes  ", "ana@anakloud.ph");

    const after = await db!.query(
      "select display_name, email from respondents where id = $1",
      [RO],
    );
    expect(after.rows[0].display_name).toBe("Ana Reyes");
    expect(after.rows[0].email).toBe("ana@anakloud.ph");

    // With a name on file but no ground-rules acknowledgement, the next claim
    // lands on the ground-rules screen rather than re-asking for a name.
    expect(await claimDestination(db!, RO)).toBe("/ground-rules");

    // Leaving the email blank (a later resume) clears an earlier value.
    await setRespondentName(db!, RO, "Ana Reyes", "   ");
    const cleared = await db!.query(
      "select display_name, email from respondents where id = $1",
      [RO],
    );
    expect(cleared.rows[0].display_name).toBe("Ana Reyes");
    expect(cleared.rows[0].email).toBeNull();
  });

  it("setGroundRulesAcknowledged records the one-time acknowledgement", async () => {
    // Starts unacknowledged even though the name is on file.
    expect(await groundRulesAcknowledged(db!, RO)).toBe(false);
    expect(await claimDestination(db!, RO)).toBe("/ground-rules");

    await setGroundRulesAcknowledged(db!, RO);
    expect(await groundRulesAcknowledged(db!, RO)).toBe(true);

    // With the acknowledgement the claim restores the session instead.
    expect(await claimDestination(db!, RO)).toBe("/");

    // Idempotent: re-acknowledging keeps the first timestamp and never
    // re-gates the respondent.
    await setGroundRulesAcknowledged(db!, RO);
    const row = await db!.query(
      "select ground_rules_acknowledged_at from respondents where id = $1",
      [RO],
    );
    expect(row.rows[0].ground_rules_acknowledged_at).not.toBeNull();
    expect(await groundRulesAcknowledged(db!, RO)).toBe(true);
  });
});