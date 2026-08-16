import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import type { AICallLevel, AICallPurpose } from "./log";

// Budget accounting (F12-T04, spec.md §7.2, tech_infrastructure.md §6.4).
//
// This is the enforcement side of the token budget, the mirror of the read
// side in lib/admin-strip.ts (which the dashboard strip already uses). The
// guarantees it exists to hold:
//
//   - per-cohort input/output caps are set at cohort creation, in ai_budget's
//     §3 columns (createBudgetForCohort);
//   - a per-respondent coach-call ceiling (default 40) refuses further coach
//     calls once crossed — a refused call simply serves the deterministic
//     sibling, so the questionnaire keeps working (PR4, PR3);
//   - per-request output caps (200 coach / 1500 analysis) bound what the model
//     is asked to return, applied by the gateway as a ceiling (see the
//     request stage in lib/ai-gateway.ts);
//   - the token counters are incremented INSIDE the same transaction as the
//     interaction log row (recordModelCall). A crash between the provider
//     response and the commit loses neither the row nor the counter — or,
//     seen from the other side, a crash can never leave a counter increment
//     with no log row, or a log row with no counter. The two are committed
//     together or not at all;
//   - when the cohort hits 100%, the circuit opens permanently and the level
//     pins to L2 (spec.md §7.2) — again inside that same transaction, so the
//     halt and the spend that caused it cannot be observed apart.

/** How many coach calls a single respondent may make (tech_infrastructure §6.4). */
export const PER_RESPONDENT_COACH_CALL_CEILING = 40;

/** Cohort-level input cap used when one is not supplied at cohort creation. */
export const DEFAULT_COHORT_INPUT_CAP = 1_000_000;

/** Cohort-level output cap used when one is not supplied at cohort creation. */
export const DEFAULT_COHORT_OUTPUT_CAP = 500_000;

/** The per-request output cap for an analyser-style call (§6.4: 1500 analysis). */
export const ANALYSIS_REQUEST_OUTPUT_CAP = 1500;

/** The per-request output cap for a coach call (§6.4: 200). */
const COACH_REQUEST_OUTPUT_CAP = 200;

/** The caps for the cohort token budget, as set at cohort creation. */
export interface BudgetCaps {
  inputCap: number;
  outputCap: number;
}

/**
 * The hard per-request output ceiling for a purpose (tech_infrastructure
 * §6.4). §6.4 names coach (200) and analysis (1500); synthesis is the other
 * analyser-style purpose, so it shares the analysis cap rather than inventing
 * a figure the spec never chose.
 */
export function perRequestOutputCap(purpose: AICallPurpose): number {
  return purpose === "coach" ? COACH_REQUEST_OUTPUT_CAP : ANALYSIS_REQUEST_OUTPUT_CAP;
}

/**
 * Whether the cohort token budget is spent — the §7.2 "credits exhausted"
 * condition. Measured against both directions, because a runaway *output*
 * loop is the realistic failure and must trip on its own counter. A cap is
 * reached at >=, so 100% and over both count as exhausted.
 */
export function isBudgetExhausted(budget: {
  inputCap: number;
  inputUsed: number;
  outputCap: number;
  outputUsed: number;
}): boolean {
  return budget.inputUsed >= budget.inputCap || budget.outputUsed >= budget.outputCap;
}

/**
 * Whether a respondent may make another coach call, given how many they have
 * already made. The default ceiling is well above 3 nudges × 8 coachable
 * questions (tech_infrastructure §6.4), so it only ever trips on abuse or a
 * retry loop — and a tripped ceiling means "serve the deterministic hint",
 * never "block the respondent" (PR4).
 */
export function coachCallsAllowed(alreadyMade: number): boolean {
  return alreadyMade < PER_RESPONDENT_COACH_CALL_CEILING;
}

/**
 * Create a cohort's token budget row with its caps. Runs at cohort creation,
 * so a cohort always has a cap to measure spend against before the first call.
 * Idempotent (`on conflict do nothing`), so re-running cohort setup cannot
 * reset or double any spend that has already accrued.
 */
export async function createBudgetForCohort(
  db: ClientBase,
  cohortId: string,
  caps: BudgetCaps = {
    inputCap: DEFAULT_COHORT_INPUT_CAP,
    outputCap: DEFAULT_COHORT_OUTPUT_CAP,
  },
): Promise<void> {
  await db.query(
    `insert into ai_budget (cohort_id, input_cap, output_cap)
     values ($1, $2, $3)
     on conflict (cohort_id) do nothing`,
    [cohortId, caps.inputCap, caps.outputCap],
  );
}

/**
 * Read the cohort's live token counters and caps — everything a caller needs
 * to compute `GatewayContext.budgetExhausted` for the next request.
 */
export async function loadBudget(
  db: ClientBase,
  cohortId: string,
): Promise<{
  inputCap: number;
  inputUsed: number;
  outputCap: number;
  outputUsed: number;
} | null> {
  const { rows } = await db.query(
    `select input_cap, input_used, output_cap, output_used
       from ai_budget
      where cohort_id = $1`,
    [cohortId],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    inputCap: r.input_cap,
    inputUsed: r.input_used,
    outputCap: r.output_cap,
    outputUsed: r.output_used,
  };
}

/**
 * How many coach calls a respondent has already made. Counts every retained
 * `coach` interaction row — both the deterministic L2 nudges and any model-
 * served calls — so the per-respondent ceiling is over total coaching, which
 * is what the §6.4 loop-protection intent is about.
 */
export async function countCoachCalls(
  db: ClientBase,
  respondentId: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n
       from ai_interactions
      where respondent_id = $1 and purpose = 'coach'`,
    [respondentId],
  );
  return rows[0].n;
}

/** A ship-shape record of one served AI call, mirroring ai_interactions §3. */
export interface RecordedModelCall {
  cohortId: string;
  respondentId: string | null;
  questionId: string | null;
  purpose: AICallPurpose;
  attemptNo: number | null;
  /** The level that actually served the call (F12-T02's "what served it"). */
  level: AICallLevel;
  model: string | null;
  verdict: string | null;
  hintText: string | null;
  exampleShown: boolean;
  answerChanged: boolean | null;
  inputTokens: number;
  outputTokens: number;
  guardTripped: string | null;
}

/**
 * Atomically write one interaction log row and increment the cohort's token
 * counters in the SAME transaction (tech_infrastructure §6.4). The invariants:
 *
 *   - the row and the counters commit together, so a crash between the
 *     provider response and the commit cannot lose one without the other;
 *   - when the increment pushes the cohort to 100%, the circuit opens
 *     permanently (`circuit_until = null`) and the cohort's served level pins
 *     to L2 — §7.2's halt, committed with the spend that caused it.
 *
 * `respondent_id` and `question_id` come from the caller's session-owned
 * context; no answer text or respondent identity is ever written, matching the
 * F05-T05 interaction logger and the §8 privacy rules.
 */
export async function recordModelCall(
  db: ClientBase,
  call: RecordedModelCall,
): Promise<void> {
  await db.query("begin");
  try {
    await db.query(
      `insert into ai_interactions (
         id, respondent_id, question_id, purpose, attempt_no, level, model,
         verdict, hint_text, example_shown, answer_changed,
         input_tokens, output_tokens, guard_tripped
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        randomUUID(),
        call.respondentId,
        call.questionId,
        call.purpose,
        call.attemptNo,
        call.level,
        call.model,
        call.verdict,
        call.hintText,
        call.exampleShown,
        call.answerChanged,
        call.inputTokens,
        call.outputTokens,
        call.guardTripped,
      ],
    );

    const { rows } = await db.query(
      `update ai_budget
          set input_used = input_used + $1,
              output_used = output_used + $2
        where cohort_id = $3
      returning input_used, output_used, input_cap, output_cap`,
      [call.inputTokens, call.outputTokens, call.cohortId],
    );
    const budget = rows[0];

    if (
      budget !== undefined &&
      (budget.input_used >= budget.input_cap || budget.output_used >= budget.output_cap)
    ) {
      // Permanent halt (spec.md §7.2): open the circuit with no recovery
      // deadline and pin the level to L2. `circuit_until = null` is what makes
      // circuitOpenAt treat the breaker as open forever (lib/circuit.ts).
      await db.query(
        `update ai_budget
            set circuit_open = true,
                circuit_reason = 'budget exhausted',
                circuit_until = null
          where cohort_id = $1`,
        [call.cohortId],
      );
      await db.query(
        "update cohorts set ai_level_pin = 'L2' where id = $1",
        [call.cohortId],
      );
    }

    await db.query("commit");
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}