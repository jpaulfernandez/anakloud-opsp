import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import {
  issueInvite,
  resolveInvite,
  revokeInvite,
} from "../../lib/invites";
import { migrate } from "../../lib/migrate";

// F02-T01 acceptance against a real Postgres. Runs only when the operator
// opts in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, and works
// inside a temporary schema it drops afterwards — the same pattern as the other
// DB tests. The respondents/cohorts tables are not RLS-gated, so these queries
// run directly.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const OPEN_COHORT = "abababab-abab-abab-abab-abababababab";
const CLOSED_COHORT = "cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd";

const VALID_RO = "aaaaaaaa-aaaa-0000-0000-000000000001";
const REVOKE_RO = "bbbbbbbb-bbbb-0000-0000-000000000002";
const ISSUE_A_RO = "cccccccc-cccc-0000-0000-000000000003";
const ISSUE_B_RO = "dddddddd-dddd-0000-0000-000000000004";
const CLOSED_RO = "eeeeeeee-eeee-0000-0000-000000000005";

describe.skipIf(!enabled)("invite token lifecycle against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `invites_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Open', 'Q4 2026', 'open')",
      [OPEN_COHORT],
    );
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Closed', 'Q4 2026', 'closed')",
      [CLOSED_COHORT],
    );

    const insertRespondent = (id: string, cohort: string, token: string) =>
      db!.query(
        `insert into respondents (id, cohort_id, display_name, invite_token, resume_code)
         values ($1, $2, 'R', $3, 'ABCDEF')`,
        [id, cohort, token],
      );

    await insertRespondent(VALID_RO, OPEN_COHORT, "token-valid");
    await insertRespondent(REVOKE_RO, OPEN_COHORT, "token-revoke-me");
    await insertRespondent(ISSUE_A_RO, OPEN_COHORT, "token-issue-a");
    await insertRespondent(ISSUE_B_RO, OPEN_COHORT, "token-issue-b");
    await insertRespondent(CLOSED_RO, CLOSED_COHORT, "token-closed");
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("resolves a token that exists on an open cohort", async () => {
    const resolved = await resolveInvite(db!, "token-valid");
    expect(resolved).toEqual({
      respondentId: VALID_RO,
      cohortId: OPEN_COHORT,
      isFacilitator: false,
    });
  });

  it("returns null for an unknown token", async () => {
    expect(await resolveInvite(db!, "no-such-token")).toBeNull();
  });

  it("returns null for a token on a closed cohort", async () => {
    expect(await resolveInvite(db!, "token-closed")).toBeNull();
  });

  it("issues distinct tokens that each resolve to exactly their own respondent", async () => {
    const tokenA = await issueInvite(db!, ISSUE_A_RO);
    const tokenB = await issueInvite(db!, ISSUE_B_RO);

    expect(tokenA).not.toBe(tokenB);
    expect(tokenA.length).toBe(43);
    expect(tokenB.length).toBe(43);

    const resA = await resolveInvite(db!, tokenA);
    const resB = await resolveInvite(db!, tokenB);
    expect(resA?.respondentId).toBe(ISSUE_A_RO);
    expect(resB?.respondentId).toBe(ISSUE_B_RO);
    expect(resA?.cohortId).toBe(OPEN_COHORT);
    expect(resB?.cohortId).toBe(OPEN_COHORT);
  });

  it("revoking an invite makes its token fail to claim", async () => {
    expect(await resolveInvite(db!, "token-revoke-me")).not.toBeNull();

    await revokeInvite(db!, REVOKE_RO);
    expect(await resolveInvite(db!, "token-revoke-me")).toBeNull();
  });

  it("makes a revoked token fail identically to an unknown token", async () => {
    // resolveInvite collapses "unknown", "revoked" and "closed cohort" into the
    // same null, so the claim path branches only on valid vs invalid. The
    // neutral screen is therefore identical for all three by construction.
    expect(await resolveInvite(db!, "token-revoke-me")).toBeNull();
    expect(await resolveInvite(db!, "no-such-token")).toBeNull();
  });

  it("rejects claiming with a token for a respondent that does not exist", async () => {
    await expect(issueInvite(db!, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
    await expect(revokeInvite(db!, "00000000-0000-0000-0000-000000000000")).rejects.toThrow();
  });
});