// The /api/coach orchestrator (F13-T04, tech_infrastructure.md §6.2, spec.md
// §10 criterion 7, PR3, PR6). This is the part of the route that is testable
// without a server or a database: it turns "one answer + a runtime
// GatewayContext + a provider" into the coach response the browser consumes.
//
// The whole of the ticket's contract lives here, separated from the thin route
// adapter below:
//
//   - `/api/coach` never returns a 5xx. The gateway already guarantees the
//     provider path resolves to a lower level instead of throwing, so a
//     healthy call, a timeout, a guard trip, an exhausted budget and every
//     provider error all come back as a servable coach body. `serveCoach` adds
//     the one remaining edge — a model reply that does not parse as §5.3
//     structured output — by falling it through to the deterministic hint.
//   - When the model cannot answer within the §6.2 timeout, the respondent
//     gets a deterministic verdict served at a lower level: the static hint
//     for the question (L2).
//   - The body carries `level` so the caller can log which level served; the
//     UI must not surface it (PR6).
//
// No name, id, email or other answer is accepted or returned here. The answer
// under evaluation was resolved by the caller via loadCoachRequest (F13-T02),
// and this module renders exactly that one answer into the provider request —
// nothing else about the respondent travels.

import type { ClientBase } from "pg";
import type { QuestionId } from "./questions";
import { callProvider } from "./ai-gateway";
import type {
  AIProvider,
  GatewayContext,
  GatewayResult,
  ProviderRequest,
} from "./ai-gateway";
import {
  COACH_RESULT_TOOL,
  buildCoachMessages,
  parseCoachResponse,
  type CoachOutput,
  type CoachRequestContext,
} from "./coach-prompt";
import { perRequestOutputCap, isBudgetExhausted, loadBudget } from "./budget";
import { circuitOpenAt, loadCircuit } from "./circuit";
import { STATIC_HINTS, type StaticHint } from "./static-hints";
import { loadConfig } from "./config";
import { fetchCohortLive, resolveServedLevel } from "./cohort-lifecycle";
import type { ResolvedSession } from "./session";
import { isCurrentLatencyDegraded, type TargetLevel } from "./ai-gateway";

/** A coach response as the browser receives it: §5.3 output + the served level. */
export type CoachResponseBody = CoachOutput & {
  /**
   * The level that actually served the request (§6.2). Carried for logging
   * only; the respondent-facing UI must never render it (PR6).
   */
  level: "L0" | "L1" | "L2";
};

/**
 * The current level of the cohort about to be served. Reads the cohort's live
 * pin (§6.1 "if cohort.ai_level_pin → use it") and the boot default, resolves
 * them with `resolveServedLevel`, and folds in the runtime health flags the
 * gateway's `selectLevel` consumes: budget exhaustion, the circuit and the
 * recent-latency signal.
 *
 * A resolved L3 is mapped to a gateway pin of L2: L3 is the plain-form mode
 * where the coach never runs, so a stray call (the client should never make
 * one) still serves a deterministic result rather than 5xx.
 */
export async function buildCoachGatewayContext(
  db: ClientBase,
  session: Pick<ResolvedSession, "cohortId" | "respondentId">,
  questionId: QuestionId,
  exampleRequested: boolean,
): Promise<GatewayContext> {
  const cohort = await fetchCohortLive(db, session.cohortId);
  const served = resolveServedLevel(loadConfig().aiLevel, cohort?.aiLevelPin ?? null);

  const pin: TargetLevel =
    served === "L0" || served === "L1" || served === "L2"
      ? served
      : served === "auto"
        ? "auto"
        : "L2";

  const budget = await loadBudget(db, session.cohortId);
  const budgetExhausted = budget !== null && isBudgetExhausted(budget);
  const circuit = await loadCircuit(db, session.cohortId);
  const circuitOpen = circuitOpenAt(circuit, Date.now());

  return {
    purpose: "coach",
    pin,
    budgetExhausted,
    circuitOpen,
    latencyDegraded: isCurrentLatencyDegraded(),
    // F12-T06: each gateway call writes exactly one ai_interactions row. Only
    // identity metadata is carried — no answer text; `exampleShown` is known up
    // front from the request, the rest of the row (level, tokens, guard) is
    // filled by the gateway from the served result.
    record: {
      db,
      cohortId: session.cohortId,
      respondentId: session.respondentId,
      questionId,
      exampleShown: exampleRequested,
    },
  };
}

/**
 * Build the provider request for one coach call. This is the payload sent to
 * the model's structured-output mode (§5.2 + §5.3): the system prompt, one
 * user turn carrying only question metadata + the single answer under
 * evaluation, and the forced `coach_result` tool. `prompt` is unused when
 * `structuredOutput` is set.
 */
export function buildCoachProviderRequest(
  ctx: CoachRequestContext,
  model: string,
): ProviderRequest {
  const messages = buildCoachMessages(ctx);
  return {
    prompt: "",
    model,
    maxTokens: perRequestOutputCap("coach"),
    structuredOutput: {
      system: messages.system,
      userMessage: messages.messages[0]!.content,
      tool: COACH_RESULT_TOOL,
    },
  };
}

/** The static §5.4-compliant hint for a question, or empty when there is none. */
function staticHintFor(questionId: string): string {
  const s = (STATIC_HINTS as Record<string, StaticHint | undefined>)[questionId];
  return s?.hint ?? "";
}

/**
 * Shape a gateway result into the coach body. A healthy L0 result is parsed
 * back into §5.3 structured output and served at L0. Everything else — a
 * timeout, a provider failure, a budget/circuit stop, a guard trip, or an
 * unparseable model reply — serves the deterministic static hint at the level
 * the gateway chose (L1 or L2), never an error surface (PR3, PR6). `level` is
 * reported so the caller can log it.
 */
export function coachResponseFromResult(
  ctx: CoachRequestContext,
  result: GatewayResult,
): CoachResponseBody {
  if (!result.degraded && result.provider !== undefined) {
    try {
      const output = parseCoachResponse(result.provider.text);
      return { ...output, level: "L0" };
    } catch {
      // Not a §5.3-shaped reply despite a clean guard pass: this is a leak the
      // guard did not classify, so it must not reach the browser. Fall through
      // to the deterministic sibling rather than 5xx.
    }
  }
  const degradedLevel = result.level === "L1" ? "L1" : "L2";
  return {
    verdict: "needs_work",
    dimension: null,
    hint: staticHintFor(ctx.questionId),
    example: "",
    level: degradedLevel,
  };
}

/** Run one coach request through the gateway and shape the served response. */
export async function serveCoach(
  ctx: CoachRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<CoachResponseBody> {
  const result = await callProvider(
    gateway,
    provider,
    buildCoachProviderRequest(ctx, model),
  );
  return coachResponseFromResult(ctx, result);
}

/**
 * The deterministic L2 coach body used on the route's outermost failure edge.
 * `questionId` may be unknown if the failure happened before the body was
 * validated, in which case there is no static hint to attach — the response is
 * still a normal needs-work body, just with an empty hint, and still never a
 * 5xx (F13-T04 "under any condition").
 */
export function degradedCoachBody(questionId: string | null): CoachResponseBody {
  return {
    verdict: "needs_work",
    dimension: null,
    hint: questionId === null ? "" : staticHintFor(questionId),
    example: "",
    level: "L2",
  };
}