// The AI gateway (F12-T01, tech_infrastructure.md §2). The single chokepoint
// every provider call in the product passes through, in the ticket's order:
//
//   level selection → budget check → circuit check → request → timeout
//   → output guard → logging
//
// The ordering is load-bearing: the level is chosen first, the request only
// happens after the budget and circuit gates have confirmed it, the request is
// time-bounded, the model output is guarded, and exactly one log line is
// emitted per call. The fallback is deterministic — any gate that fails, any
// provider error, or any timeout drops the call to a lower level and the
// pipeline returns a valid result instead of throwing. Consumers read
// `GatewayResult.level` and serve the corresponding sibling: an L2 result is
// the static deterministic response, never an error (PR6, PR3).
//
// Server-side only: this module (and lib/provider.ts, which only it imports)
// is never reachable from a client bundle. A scan test in F12-T01 forbids any
// module but this one from importing the provider boundary or an SDK, and
// forbids any "use client" file from importing the gateway.

import {
  PROVIDER_TIMEOUT_MS,
  type AIProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider";
import { hintViolations } from "./coach-containment";
import { logAICall, type AICallLevel, type AICallPurpose } from "./log";

export type {
  AIProvider,
  ProviderRequest,
  ProviderResponse,
} from "./provider";
export { PROVIDER_TIMEOUT_MS } from "./provider";

/**
 * The target level for a request. `auto` (or undefined) lets the runtime pick
 * from health, budget and circuit state; the rest force a level.
 */
export type TargetLevel = "L0" | "L1" | "L2" | "auto";

/**
 * Everything the gateway needs to serve one call. The health flags are read
 * by the caller from server state (cohort rows, ai_budget, recent-call
 * latency) — F12-T02/T03/T04 own how they are computed; this module only
 * reads them in the fixed precedence.
 */
export interface GatewayContext {
  /** Which call this is ("coach" | "analysis" | "synthesis"). */
  purpose: AICallPurpose;
  /** Cohort or boot pin; `auto`/undefined selects from the health flags. */
  pin?: TargetLevel;
  /** True when the cohort token budget is exhausted (F12-T04). */
  budgetExhausted: boolean;
  /** True when the circuit is open (F12-T03). */
  circuitOpen: boolean;
  /** True when p95 latency over recent calls exceeds 6s (F12-T02). */
  latencyDegraded: boolean;
  /** Override the per-request timeout (tests); defaults to §6.2's 6s. */
  timeoutMs?: number;
}

/**
 * What the gateway returns. `level` is what actually served the call, so a
 * pinned L0 that hit an exhausted budget reports L2, matching `ai_budget`.
 * `degraded` flags that the model was not consulted, so the caller serves the
 * deterministic sibling instead of reading `provider`.
 */
export interface GatewayResult {
  /** The level that actually served the request (not the requested one). */
  level: AICallLevel;
  /** Raw provider output; absent when no usable model call was made. */
  provider?: ProviderResponse;
  /** True when the call was not served by a model (serve the static sibling). */
  degraded: boolean;
  /** The output guard that tripped, when one did (§11 trip metric). */
  guardTripped?: string;
}

/**
 * Level selection (tech_infrastructure.md §6.1, in its precedence order). A
 * pin wins over every automatic condition; otherwise budget exhaustion and an
 * open circuit both go to L2, latency goes to L1, and a healthy call is L0.
 */
export function selectLevel(
  ctx: Pick<GatewayContext, "pin" | "budgetExhausted" | "circuitOpen" | "latencyDegraded">,
): AICallLevel {
  if (ctx.pin === "L0" || ctx.pin === "L1" || ctx.pin === "L2") return ctx.pin;
  if (ctx.budgetExhausted) return "L2";
  if (ctx.circuitOpen) return "L2";
  if (ctx.latencyDegraded) return "L1";
  return "L0";
}

/** State threaded through the pipeline stages. */
interface Run {
  ctx: GatewayContext;
  provider: AIProvider;
  req: ProviderRequest;
  level: AICallLevel;
  startedAt: number;
  elapsedMs: number;
  pending: Promise<ProviderResponse> | null;
  providerResult?: ProviderResponse;
  guardTripped?: string;
}

/** A stage may continue to the next, or stop with a finished result. */
type StageDecision =
  | { kind: "continue" }
  | { kind: "stop"; level: AICallLevel; degraded: boolean; guardTripped?: string };

type Stage = (run: Run) => Promise<StageDecision>;

const CONTINUE: StageDecision = { kind: "continue" };

// 1. Level selection (tech_infrastructure.md §6.1). L1 and L2 both mean "no
// provider call": L1 is deterministic-validators-only and L2 is rule-based, so
// the pipeline can stop here for both. L0 continues to the budget and circuit
// gates, which are re-checked right before the request so state that changed
// between selection and call cannot slip through.
async function levelStage(run: Run): Promise<StageDecision> {
  run.level = selectLevel(run.ctx);
  if (run.level !== "L0") {
    return { kind: "stop", level: run.level, degraded: true };
  }
  return CONTINUE;
}

// 2. Budget gate (F12-T04 owns the caps; this is the exhaustion failsafe). It
// runs after level selection so a just-exhausted budget — or a pin that read
// L0 before the cohort hit 100% — still forces L2 here.
async function budgetStage(run: Run): Promise<StageDecision> {
  if (run.ctx.budgetExhausted) {
    run.level = "L2";
    return { kind: "stop", level: "L2", degraded: true };
  }
  return CONTINUE;
}

// 3. Circuit gate (F12-T03 owns open/probe; this is the open failsafe).
async function circuitStage(run: Run): Promise<StageDecision> {
  if (run.ctx.circuitOpen) {
    run.level = "L2";
    return { kind: "stop", level: "L2", degraded: true };
  }
  return CONTINUE;
}

// 4. Request — hand the self-contained prompt to the provider. The call is
// started but not awaited here; the timeout stage owns bounding it, so the two
// are distinct stages in the ticket's order.
async function requestStage(run: Run): Promise<StageDecision> {
  run.pending = run.provider.request(run.req);
  return CONTINUE;
}

// 5. Timeout — bound the in-flight request (tech_infrastructure.md §6.2; F12-T05
// owns the retry policy). A timeout or a provider rejection both fall through
// to L2: the respondent is waiting, so nothing is retried here.
async function timeoutStage(run: Run): Promise<StageDecision> {
  const pending = run.pending;
  if (pending === null) {
    return { kind: "stop", level: "L2", degraded: true };
  }
  const timeoutMs = run.ctx.timeoutMs ?? PROVIDER_TIMEOUT_MS;
  const timedOut = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    pending.then(
      () => {
        clearTimeout(timer);
        resolve(false);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
  run.elapsedMs = Date.now() - run.startedAt;
  if (timedOut) {
    return { kind: "stop", level: "L2", degraded: true };
  }
  try {
    run.providerResult = await pending;
  } catch {
    return { kind: "stop", level: "L2", degraded: true };
  }
  return CONTINUE;
}

// 6. Output guard (tech_infrastructure.md §5.4). Coach output is scanned for
// banned terms, over-length and digits; a trip discards the model output and
// serves the deterministic sibling (F13-T03 owns the structured parse). The
// facilitator-only purposes are not coach output, so they have no such guard.
async function guardStage(run: Run): Promise<StageDecision> {
  if (run.ctx.purpose !== "coach") return CONTINUE;
  const output = run.providerResult;
  if (output === undefined) return CONTINUE;
  const violations = hintViolations(output.text);
  if (violations.length > 0) {
    run.guardTripped = violations.join("; ");
    return { kind: "stop", level: "L2", degraded: true, guardTripped: run.guardTripped };
  }
  return CONTINUE;
}

// 7. Logging — one structured line per call with the five §11 fields, carrying
// nothing that could be answer content (F12-T06 owns the ai_interactions row).
function logRun(run: Run, result: GatewayResult): void {
  logAICall({
    purpose: run.ctx.purpose,
    level: result.level,
    latencyMs: run.elapsedMs,
    tokens: {
      input: result.provider?.inputTokens ?? 0,
      output: result.provider?.outputTokens ?? 0,
    },
    guardResult: result.guardTripped ?? "ok",
  });
}

const STAGES: Stage[] = [
  levelStage,
  budgetStage,
  circuitStage,
  requestStage,
  timeoutStage,
  guardStage,
];

async function runPipeline(run: Run): Promise<GatewayResult> {
  for (const stage of STAGES) {
    const decision = await stage(run);
    if (decision.kind === "stop") {
      return {
        level: decision.level,
        degraded: decision.degraded,
        guardTripped: decision.guardTripped,
      };
    }
  }
  return {
    level: run.level,
    degraded: false,
    guardTripped: run.guardTripped,
    provider: run.providerResult,
  };
}

/**
 * Run one provider call through the gateway — the single entry point for AI in
 * the product. Consumers never touch the provider SDK directly; they call this
 * and read `GatewayResult.level` to decide which sibling to serve.
 *
 * Never throws. Any stage that fails — a gate, a provider error, a timeout, a
 * guard trip — produces a valid lower-level result the caller can serve
 * deterministically, so the form keeps working with the AI gone (PR3).
 */
export async function callProvider(
  ctx: GatewayContext,
  provider: AIProvider,
  req: ProviderRequest,
): Promise<GatewayResult> {
  const run: Run = {
    ctx,
    provider,
    req,
    level: "L0",
    startedAt: Date.now(),
    elapsedMs: 0,
    pending: null,
  };
  try {
    const result = await runPipeline(run);
    logRun(run, result);
    return result;
  } catch {
    // An unexpected failure anywhere must never reach a caller (F12-T01).
    // Serve L2, and log it as a guard trip so the §11 metric still counts.
    run.elapsedMs = Date.now() - run.startedAt;
    const result: GatewayResult = {
      level: "L2",
      degraded: true,
      guardTripped: "gateway_failed",
    };
    logRun(run, result);
    return result;
  }
}