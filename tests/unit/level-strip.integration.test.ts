import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  advanceAndPersistBudgetAlerts,
  fetchBudget,
  fetchGuardTrips,
} from "../../lib/admin-strip";

// F09-T04 — the admin strip's data path against a real Postgres. Runs only
// when opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise,
// inside a temporary schema it drops afterwards — the same pattern as the
// other DB tests. Proves the SQL behind the strip: a cohort with no budget row
// reads null (the honest P1 "—"), a present row is surfaced whole, and the
// guard-trip count is scoped to the facilitator's own cohort.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "bbbb1111-bbbb-1111-bbbb-111111111401";
const OTHER_COHORT = "bbbb1111-bbbb-1111-bbbb-111111111402";
const RESPONDENT = "bbbb1111-bbbb-1111-bbbb-111111111403";
const OTHER_RESPONDENT = "bbbb1111-bbbb-1111-bbbb-111111111404";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

describe.skipIf(!enabled)("admin level strip data against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `level_strip_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    for (const cohort of [COHORT, OTHER_COHORT]) {
      await db!.query(
        `insert into cohorts (id, name, quarter_label, status)
         values ($1, 'Test', 'Q4 2026', 'open')`,
        [cohort],
      );
    }
    await insertRespondent(RESPONDENT, COHORT, "Token R1", "token-strip-1", "LST1");
    await insertRespondent(OTHER_RESPONDENT, OTHER_COHORT, "Token R2", "token-strip-2", "LST2");
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("returns null for a cohort with no budget row yet (the honest P1 state)", async () => {
    expect(await fetchBudget(db!, COHORT)).toBeNull();
  });

  it("surfaces the cohort's budget row when one exists", async () => {
    await db!.query(
      `insert into ai_budget
         (cohort_id, input_cap, input_used, output_cap, output_used,
          circuit_open, circuit_reason)
       values ($1, 1000, 750, 2000, 1150, true, 'budget exhausted')`,
      [COHORT],
    );
    const budget = await fetchBudget(db!, COHORT);
    expect(budget).not.toBeNull();
    expect(budget!.inputCap).toBe(1000);
    expect(budget!.inputUsed).toBe(750);
    expect(budget!.outputCap).toBe(2000);
    expect(budget!.outputUsed).toBe(1150);
    expect(budget!.circuitOpen).toBe(true);
    expect(budget!.circuitReason).toBe("budget exhausted");
  });

  it("counts guard trips for the cohort only", async () => {
    // Two rejected coach calls in this cohort, none in the other.
    await db!.query(
      `insert into ai_interactions
         (id, respondent_id, purpose, level, guard_tripped)
       values
         ($1, $2, 'coach', 'L0', 'form'),
         ($3, $2, 'coach', 'L0', 'content')`,
      [
        "bbbb1111-bbbb-1111-bbbb-111111111501",
        RESPONDENT,
        "bbbb1111-bbbb-1111-bbbb-111111111502",
      ],
    );
    // A clean call must not count as a trip.
    await db!.query(
      `insert into ai_interactions (id, respondent_id, purpose, level)
       values ($1, $2, 'coach', 'L2')`,
      ["bbbb1111-bbbb-1111-bbbb-111111111503", RESPONDENT],
    );

    expect(await fetchGuardTrips(db!, COHORT)).toBe(2);
    expect(await fetchGuardTrips(db!, OTHER_COHORT)).toBe(0);
  });

  it("fires each budget threshold once, persisting the fired flag", async () => {
    // Establish a clean cohort at 75% of the combined cap.
    await db!.query(
      `update ai_budget
          set input_used = 75, output_used = 75, input_cap = 100, output_cap = 100,
              warn70_fired = false, warn90_fired = false
        where cohort_id = $1`,
      [COHORT],
    );
    const keepFlags = (used: number) =>
      db!.query(
        `update ai_budget
            set input_used = $1, output_used = $1
          where cohort_id = $2`,
        [used, COHORT],
      );

    const at75 = await fetchBudget(db!, COHORT);
    expect(await advanceAndPersistBudgetAlerts(db!, COHORT, at75!)).toEqual([
      "warn70",
    ]);

    // Reload at a higher-but-still-70% spend: the flag persisted, so nothing
    // re-fires — the "not on every request" acceptance, proven against a real
    // database rather than only in the pure state machine.
    await keepFlags(85);
    const at85 = await fetchBudget(db!, COHORT);
    expect(at85!.warn70Fired).toBe(true);
    expect(at85!.warn90Fired).toBe(false);
    expect(await advanceAndPersistBudgetAlerts(db!, COHORT, at85!)).toEqual([]);

    // Cross 90%: warn90 fires once, persists, then stays quiet.
    await keepFlags(95);
    const at95 = await fetchBudget(db!, COHORT);
    expect(await advanceAndPersistBudgetAlerts(db!, COHORT, at95!)).toEqual([
      "warn90",
    ]);
    expect((await fetchBudget(db!, COHORT))!.warn90Fired).toBe(true);
    const recheck = await fetchBudget(db!, COHORT);
    expect(await advanceAndPersistBudgetAlerts(db!, COHORT, recheck!)).toEqual(
      [],
    );
  });
});

async function insertRespondent(
  id: string,
  cohort: string,
  name: string,
  invite: string,
  code: string,
) {
  await db!.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, $3, $4, $5, false)`,
    [id, cohort, name, invite, code],
  );
}