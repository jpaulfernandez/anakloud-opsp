import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { createBudgetForCohort, loadBudget } from "../../lib/budget";
import {
  callProvider,
  type AIProvider,
  type GatewayContext,
  type ProviderRequest,
  type ProviderResponse,
} from "../../lib/ai-gateway";

// F12-T06 — interaction logging and token capture against a real Postgres. Runs
// only when opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise,
// inside a temporary schema it drops afterwards — the same pattern as the other
// DB tests (budget.integration.test.ts).
//
// Proves the DB-backed half of the acceptance criteria, which the pure unit
// tests cannot: the gateway writes EXACTLY ONE ai_interactions row per gateway
// call — a served L0 call with non-zero token counts and the model used, and a
// degraded L2 call with zero tokens at level L2 — and both the row and the
// cohort token counters are committed together via recordModelCall (F12-T04).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

// One cohort + respondent per test, so the row/counter assertions below each
// start from a clean slate and stay independent of test order.
const COHORT_L0 = "dddd1111-dddd-1111-dddd-111111110a01";
const RESPONDENT_L0 = "dddd1111-dddd-1111-dddd-111111110a02";
const COHORT_L2 = "dddd1111-dddd-1111-dddd-111111110b01";
const RESPONDENT_L2 = "dddd1111-dddd-1111-dddd-111111110b02";
const COHORT_TWO = "dddd1111-dddd-1111-dddd-111111110c01";
const RESPONDENT_TWO = "dddd1111-dddd-1111-dddd-111111110c02";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

const REQ: ProviderRequest = {
  prompt: "Review this answer.",
  model: "pinned-model",
  maxTokens: 200,
};

/** A provider that records the requests it received and returns a clean hint. */
function recordingProvider(): {
  provider: AIProvider;
  calls: ProviderRequest[];
} {
  const calls: ProviderRequest[] = [];
  return {
    provider: {
      async request(req) {
        calls.push(req);
        return {
          text: "Count something measurable next quarter.",
          inputTokens: 120,
          outputTokens: 30,
          model: "pinned-model",
        };
      },
    },
    calls,
  };
}

function ctx(
  cohortId: string,
  respondentId: string,
  overrides: Partial<GatewayContext> = {},
): GatewayContext {
  return {
    purpose: "coach",
    pin: "auto",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    retryBackoffMs: 0,
    record: {
      db: db!,
      cohortId,
      respondentId,
      questionId: "q7",
      attemptNo: 1,
      verdict: "needs_work",
      hintText: "Make it countable.",
      exampleShown: false,
    },
    ...overrides,
  };
}

describe.skipIf(!enabled)("interaction logging and token capture on a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `gateway_log_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    const pairs: Array<[string, string]> = [
      [COHORT_L0, RESPONDENT_L0],
      [COHORT_L2, RESPONDENT_L2],
      [COHORT_TWO, RESPONDENT_TWO],
    ];
    for (const [index, [cohort, respondent]] of pairs.entries()) {
      await db!.query(
        `insert into cohorts (id, name, quarter_label, status)
         values ($1, 'Test', 'Q4 2026', 'open')`,
        [cohort],
      );
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, 'Gateway R', $3, $4, false)`,
        [respondent, cohort, `gateway-tok-${index}`, `GWY${index}`],
      );
      await createBudgetForCohort(db!, cohort);
    }
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("a served L0 call writes exactly one row with non-zero tokens and the model", async () => {
    const { provider, calls } = recordingProvider();
    const result = await callProvider(ctx(COHORT_L0, RESPONDENT_L0), provider, REQ);

    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
    expect(calls).toHaveLength(1);

    const { rows } = await db!.query(
      `select purpose, level, model, attempt_no, verdict, hint_text,
              example_shown, answer_changed, input_tokens, output_tokens, guard_tripped
         from ai_interactions where respondent_id = $1`,
      [RESPONDENT_L0],
    );
    // Exactly one row for the call, carrying every audit field.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "coach",
      level: "L0",
      model: "pinned-model",
      attempt_no: 1,
      verdict: "needs_work",
      hint_text: "Make it countable.",
      example_shown: false,
      answer_changed: false,
      input_tokens: 120,
      output_tokens: 30,
      guard_tripped: null,
    });

    // The token counters were committed in the same transaction.
    const budget = await loadBudget(db!, COHORT_L0);
    expect(budget!.inputUsed).toBe(120);
    expect(budget!.outputUsed).toBe(30);
  });

  it("a degraded pinned-L2 call writes exactly one row with zero tokens at L2", async () => {
    const { provider, calls } = recordingProvider();
    const result = await callProvider(ctx(COHORT_L2, RESPONDENT_L2, { pin: "L2" }), provider, REQ);

    // The provider is never contacted for an L2 call.
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(calls).toHaveLength(0);

    const { rows } = await db!.query(
      `select purpose, level, model, input_tokens, output_tokens, guard_tripped
         from ai_interactions where respondent_id = $1`,
      [RESPONDENT_L2],
    );
    // Exactly one row, at level L2 with zero tokens, still recording the model
    // the call was aimed at — so a mid-cohort model change stays visible (FR-35).
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      purpose: "coach",
      level: "L2",
      model: "pinned-model",
      input_tokens: 0,
      output_tokens: 0,
      guard_tripped: null,
    });

    // A zero-token L2 call spends nothing against the cohort budget.
    const budget = await loadBudget(db!, COHORT_L2);
    expect(budget!.inputUsed).toBe(0);
    expect(budget!.outputUsed).toBe(0);
  });

  it("two calls produce exactly two rows, never one or none", async () => {
    const { provider } = recordingProvider();
    await callProvider(ctx(COHORT_TWO, RESPONDENT_TWO), provider, REQ);
    await callProvider(ctx(COHORT_TWO, RESPONDENT_TWO), provider, REQ);

    const { rows } = await db!.query(
      "select count(*)::int as n from ai_interactions where respondent_id = $1",
      [RESPONDENT_TWO],
    );
    expect(rows[0].n).toBe(2);

    // Both calls' spend is counted once each.
    const budget = await loadBudget(db!, COHORT_TWO);
    expect(budget!.inputUsed).toBe(240);
    expect(budget!.outputUsed).toBe(60);
  });
});