import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  decideResumeAttempt,
  getOrCreateResumeCode,
  recentResumeAttempts,
  recordResumeAttempt,
  resolveByResumeCode,
  RESUME_MAX_ATTEMPTS,
} from "../../lib/resume";

// F02-T03 resume codes against a real Postgres. Runs only when opted in
// (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests. respondents/cohorts and the rate-limit ledger are not RLS-gated, so
// these queries run directly on the connecting role.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "cccc1111-cccc-1111-cccc-111111111111";
const RO = "cccc1111-cccc-1111-cccc-111111111112";
const RO_NO_EMAIL = "cccc1111-cccc-1111-cccc-111111111113";
const COHORT_CLOSED = "cccc1111-cccc-1111-cccc-111111111114";
const RO_CLOSED = "cccc1111-cccc-1111-cccc-111111111115";

describe.skipIf(!enabled)("resume codes against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `resume_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Open', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Closed', 'Q4 2026', 'closed')",
      [COHORT_CLOSED],
    );
    // RO has no code yet (the first-save case). RO_NO_EMAIL has an address but
    // no code. RO_CLOSED lives in a closed cohort with a code to claim.
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, email)
       values
         ($1, $2, 'Open R',   'resume-email-token',     '',       'ana@anakloud.ph'),
         ($3, $4, 'NoEmail R', 'resume-no-email-token', '',       null),
         ($5, $6, 'Closed R', 'resume-closed-token',     'ABCDEF', null)`,
      [RO, COHORT, RO_NO_EMAIL, COHORT, RO_CLOSED, COHORT_CLOSED],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  describe("getOrCreateResumeCode (first save)", () => {
    it("generates and persists a code on first save", async () => {
      const outcome = await getOrCreateResumeCode(db!, RO);
      expect(outcome.created).toBe(true);
      expect(outcome.code.length).toBe(6);
      // It was persisted, not just returned.
      const { rows } = await db!.query(
        "select resume_code from respondents where id = $1",
        [RO],
      );
      expect(rows[0].resume_code).toBe(outcome.code);
    });

    it("returns the same code on a later save and does not re-create", async () => {
      const first = await getOrCreateResumeCode(db!, RO);
      const second = await getOrCreateResumeCode(db!, RO);
      expect(second.created).toBe(false);
      expect(second.code).toBe(first.code);
    });

    it("records the email attempt and never blocks when there is no key", async () => {
      // No RESEND_API_KEY is set in this process, so the sender short-circuits
      // to { sent: false }; the outcome must still carry a usable code.
      delete process.env.RESEND_API_KEY;
      const outcome = await getOrCreateResumeCode(db!, RO_NO_EMAIL);
      expect(outcome.created).toBe(true);
      expect(outcome.emailed).toBe(false);
      expect(outcome.code.length).toBe(6);
    });
  });

  describe("resolveByResumeCode", () => {
    it("resolves an upper-case code case-insensitively", async () => {
      const resolved = await resolveByResumeCode(db!, "abcdef");
      expect(resolved?.respondentId).toBe(RO_CLOSED);
    });

    it("resolves a code for a respondent in a closed cohort", async () => {
      // F02-T03 / F02-T02: a session is admitted and read-only is decided at
      // resolution time, so a closed cohort must still resolve by code.
      const resolved = await resolveByResumeCode(db!, "ABCDEF");
      expect(resolved?.cohortId).toBe(COHORT_CLOSED);
    });

    it("returns null for an unknown code", async () => {
      expect(await resolveByResumeCode(db!, "ZZZZZZ")).toBeNull();
    });

    it("returns null for a code that is not six unambiguous symbols", async () => {
      expect(await resolveByResumeCode(db!, "O0I1AB")).toBeNull();
      expect(await resolveByResumeCode(db!, "ABCD")).toBeNull();
    });
  });

  describe("rate limiting ledger", () => {
    const ip = "203.0.113.42";
    const now = new Date();

    it("records attempts and reports the 6th attempt within the hour as rejected", async () => {
      for (let i = 0; i < RESUME_MAX_ATTEMPTS; i++) {
        await recordResumeAttempt(db!, ip);
      }
      const recent = await recentResumeAttempts(db!, ip, new Date());
      expect(recent.length).toBe(RESUME_MAX_ATTEMPTS);
      expect(decideResumeAttempt(recent, new Date()).reject).toBe(true);
    });

    it("scopes the ledger by IP", async () => {
      const other = await recentResumeAttempts(db!, "198.51.100.7", new Date());
      expect(decideResumeAttempt(other, now).reject).toBe(false);
    });
  });
});