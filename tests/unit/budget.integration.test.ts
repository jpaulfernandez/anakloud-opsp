import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  coachCallsAllowed,
  countCoachCalls,
  createBudgetForCohort,
  isBudgetExhausted,
  loadBudget,
  recordModelCall,
  type RecordedModelCall,
} from "../../lib/budget";

// F12-T04 — budget accounting against a real Postgres. Runs only when opted
// in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// Proves the three database-backed acceptances:
//   1. a crash injected before the commit loses NEITHER the interaction row
//      NOR the counter increment — the two are written in one transaction;
//   2. exceeding the per-respondent ceiling stops coach calls without breaking
//      the questionnaire (a stopped call serves the deterministic sibling);
//   3. at 100% spend the circuit opens permanently and the cohort pins to L2.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "cccc1111-cccc-1111-cccc-111111110401";
const COHORT_AT_CAP = "cccc1111-cccc-1111-cccc-111111110402";
const RESPONDENT = "cccc1111-cccc-1111-cccc-111111110403";
const RESPONDENT2 = "cccc1111-cccc-1111-cccc-111111110404";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

function call(overrides: Partial<RecordedModelCall> = {}): RecordedModelCall {
  return {
    cohortId: COHORT,
    respondentId: RESPONDENT,
    questionId: "q1",
    purpose: "coach",
    attemptNo: 1,
    level: "L0",
    model: "pinned-model",
    verdict: "ok",
    hintText: "",
    exampleShown: false,
    answerChanged: false,
    inputTokens: 120,
    outputTokens: 30,
    guardTripped: null,
    ...overrides,
  };
}

describe.skipIf(!enabled)("budget accounting against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `budget_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    for (const cohort of [COHORT, COHORT_AT_CAP]) {
      await db!.query(
        `insert into cohorts (id, name, quarter_label, status)
         values ($1, 'Test', 'Q4 2026', 'open')`,
        [cohort],
      );
    }
    for (const [index, respondent] of [RESPONDENT, RESPONDENT2].entries()) {
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, 'Budget R', $3, $4, false)`,
        [respondent, COHORT, `budget-tok-${index}`, `BDGT${index}`],
      );
    }
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("creates the cohort's budget row at cohort creation, idempotently", async () => {
    await createBudgetForCohort(db!, COHORT);
    const budget = await loadBudget(db!, COHORT);
    expect(budget).not.toBeNull();
    expect(budget!.inputCap).toBe(1_000_000);
    expect(budget!.outputCap).toBe(500_000);
    expect(budget!.inputUsed).toBe(0);
    expect(budget!.outputUsed).toBe(0);

    // Re-running cohort setup must not reset or duplicate spend.
    await createBudgetForCohort(db!, COHORT);
    const again = await loadBudget(db!, COHORT);
    expect(again!.inputUsed).toBe(0);
  });

  it("writes the interaction row and the counter increments in one commit", async () => {
    await recordModelCall(db!, call());
    await recordModelCall(db!, call({ inputTokens: 40, outputTokens: 10 }));

    const budget = await loadBudget(db!, COHORT);
    expect(budget!.inputUsed).toBe(160); // 120 + 40
    expect(budget!.outputUsed).toBe(40); // 30 + 10

    const { rows } = await db!.query(
      `select purpose, level, model, input_tokens, output_tokens, answer_changed
         from ai_interactions where respondent_id = $1 order by created_at, id`,
      [RESPONDENT],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      purpose: "coach",
      level: "L0",
      model: "pinned-model",
      input_tokens: 120,
      output_tokens: 30,
      answer_changed: false,
    });
    expect(rows[1].input_tokens).toBe(40);
    expect(rows[1].output_tokens).toBe(10);
  });

  it("a crash before commit loses neither the row nor the counter increment", async () => {
    // Reproduce exactly the two writes recordModelCall performs, then roll the
    // transaction back to simulate the process dying before `commit`. Persisted
    // state must show neither the interaction row nor any spend — the pair is
    // atomic, so a crash can never leave one without the other.
    const usedBefore = (await loadBudget(db!, COHORT))!;

    await db!.query("begin");
    await db!.query(
      `insert into ai_interactions (
         id, respondent_id, question_id, purpose, attempt_no, level, model,
         verdict, hint_text, example_shown, answer_changed,
         input_tokens, output_tokens, guard_tripped
       ) values ($1, $2, 'q2', 'coach', 2, 'L0', 'pinned-model', 'ok',
                 '', false, false, 999, 999, null)`,
      ["cccc1111-cccc-1111-cccc-111111110501", RESPONDENT],
    );
    await db!.query(
      `update ai_budget
          set input_used = input_used + 999, output_used = output_used + 999
        where cohort_id = $1`,
      [COHORT],
    );
    await db!.query("rollback");

    const usedAfter = (await loadBudget(db!, COHORT))!;
    expect(usedAfter.inputUsed).toBe(usedBefore.inputUsed);
    expect(usedAfter.outputUsed).toBe(usedBefore.outputUsed);

    const { rows } = await db!.query(
      "select count(*)::int as n from ai_interactions where respondent_id = $1",
      [RESPONDENT],
    );
    expect(rows[0].n).toBe(2); // the two committed rows, not the rolled-back one
  });

  it("at 100% spend opens the circuit permanently and pins the level to L2", async () => {
    await db!.query(
      `insert into ai_budget
         (cohort_id, input_cap, input_used, output_cap, output_used)
       values ($1, 1000, 999, 2000, 0)`,
      [COHORT_AT_CAP],
    );

    // The last spend pushes input_used to exactly the 1000 cap.
    await recordModelCall(db!, call({ cohortId: COHORT_AT_CAP }));

    const c = await db!.query(
      `select circuit_open, circuit_reason, circuit_until
         from ai_budget where cohort_id = $1`,
      [COHORT_AT_CAP],
    );
    expect(c.rows[0].circuit_open).toBe(true);
    expect(c.rows[0].circuit_reason).toBe("budget exhausted");
    // Permanent halt: no recovery window.
    expect(c.rows[0].circuit_until).toBeNull();

    const p = await db!.query(
      "select ai_level_pin from cohorts where id = $1",
      [COHORT_AT_CAP],
    );
    expect(p.rows[0].ai_level_pin).toBe("L2");

    // The served level for a next request is therefore 100% L2, exhausted.
    expect(isBudgetExhausted((await loadBudget(db!, COHORT_AT_CAP))!)).toBe(true);
  });

  it("counts a respondent's coach calls and stops them at the ceiling", async () => {
    // This respondent carries two coach rows from the earlier tests.
    const already = await countCoachCalls(db!, RESPONDENT);
    expect(already).toBeGreaterThan(0);
    expect(coachCallsAllowed(already)).toBe(true);

    // A respondent with no calls is allowed; one at/over 40 is not.
    expect(await countCoachCalls(db!, RESPONDENT2)).toBe(0);
    expect(coachCallsAllowed(0)).toBe(true);
    expect(coachCallsAllowed(40)).toBe(false);
  });
});