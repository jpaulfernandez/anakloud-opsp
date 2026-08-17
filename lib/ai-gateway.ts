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
  ProviderHttpError,
  ProviderSafetyError,
  type AIProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "./provider";
import { isLatencyDegraded, LATENCY_WINDOW } from "./latency-health";
import { guardCoachResponse } from "./output-guard";
import { logAICall, type AICallLevel, type AICallPurpose } from "./log";
import {
  perRequestOutputCap,
  recordModelCall,
  type RecordedModelCall,
} from "./budget";
import type { ClientBase } from "./db";

export type {
  AIProvider,
  ProviderRequest,
  ProviderResponse,
} from "./provider";
export {
  PROVIDER_TIMEOUT_MS,
  ProviderHttpError,
  ProviderSafetyError,
  // The concrete providers are re-exported here so no other module has to
  // import lib/provider.ts directly — the gateway stays the single sanctioned
  // door to the provider boundary (the F12-T01 import-scan enforces that). The
  // /api routes construct the active Gemini client (F18-T01) through this
  // re-export; the Anthropic implementation is retained behind the boundary as
  // the pre-migration reference, not constructed anywhere in the product.
  anthropicProvider,
  geminiProvider,
} from "./provider";

// Timeout and retry policy (tech_infrastructure.md §6.2, F12-T05): a 6s bound
// on every provider call, with at most one retry — and only on a genuine HTTP
// 429 or 503, never on a timeout. The respondent is waiting, so a timeout is
// served as an immediate lower-level fallback; and the retry backoff is
// jittered so that a cohort full of simultaneous coach calls does not all fire
// their retries in lockstep.

/** The HTTP statuses §6.2 considers worth a retry. */
const RETRIABLE_STATUSES: readonly number[] = [429, 503];

/** Base of the jittered retry backoff (§6.2 "with jittered backoff"). */
const RETRY_BACKOFF_BASE_MS = 100;

/** Random spread on top of the base backoff (jitter). */
const RETRY_BACKOFF_JITTER_MS = 200;

function isRetriableStatus(err: unknown): boolean {
  return err instanceof ProviderHttpError && RETRIABLE_STATUSES.includes(err.status);
}

/**
 * The safety-block reason on an error, when the error is one (F18-T03, M08).
 * A safety block is never an HTTP status, so this is its own signal: the
 * provider rejects with `ProviderSafetyError`, the gateway records the reason
 * in `ai_interactions.blocked_reason`, and the retry policy ignores it (a
 * block will not clear on re-send). Returns undefined for every other error so
 * ordinary HTTP failures and guard trips stay plainly distinguishable from a
 * block in the audit row.
 */
function safetyBlockReason(err: unknown): string | undefined {
  return err instanceof ProviderSafetyError ? err.reason : undefined;
}

/** A jittered retry delay; an injected override removes the jitter for tests. */
function retryBackoffMs(override: number | undefined): number {
  if (override !== undefined) return override;
  return RETRY_BACKOFF_BASE_MS + Math.floor(Math.random() * RETRY_BACKOFF_JITTER_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The target level for a request. `auto` (or undefined) lets the runtime pick
 * from health, budget and circuit state; the rest force a level.
 */
export type TargetLevel = "L0" | "L1" | "L2" | "auto";

/**
 * The audit-row metadata a gateway call may carry (F12-T06,
 * tech_infrastructure.md §3). Everything the `ai_interactions` row records
 * beyond what the pipeline itself determines — identity, attempt number, and
 * the coach content fields — comes from here, supplied by the caller that
 * built the prompt (F13 owns the coach content). The gateway only has a db for
 * the write when `record` is present; purely-formed calls (the unit tests) run
 * without one and still emit the structured log line.
 */
export interface GatewayRecord {
  /** The db handle for the row + token-counter write (F12-T04). */
  db: ClientBase;
  /** The cohort whose token budget the call consumes. */
  cohortId: string;
  respondentId?: string | null;
  questionId?: string | null;
  attemptNo?: number | null;
  verdict?: string | null;
  hintText?: string | null;
  exampleShown?: boolean;
}

/**
 * What the gateway needs to serve one call. The health flags are read
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
  /** Override the jittered retry backoff (tests); defaults to §6.2 jitter. */
  retryBackoffMs?: number;
  /** Audit-row metadata; when present the gateway writes one row per call. */
  record?: GatewayRecord;
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
  /** A Gemini safety-block reason (F18-T03), distinct from a guard trip or an HTTP failure. */
  blockedReason?: string;
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

// F12-T02 — the gateway is also the natural owner of the "recent call latency"
// signal that rule 4 reads. It measures every call that actually reached the
// provider, so a caller building the next GatewayContext can derive
// `latencyDegraded` from real provider latency rather than a flag from nowhere.
// Only calls that invoked the provider count as latency samples: a call stopped
// by level/budget/circuit/gate never contacted the model, so its 0ms is not a
// provider latency and would poison the p95 toward healthy.

/** The most recent provider-call latencies, capped at `LATENCY_WINDOW`. */
const recentProviderLatencies: number[] = [];

/** Forget recorded latencies (tests only — health state starts empty at boot). */
export function resetLatencyHealth(): void {
  recentProviderLatencies.length = 0;
}

/** How many provider latencies are currently recorded (tests only). */
export function providerLatencySampleCount(): number {
  return recentProviderLatencies.length;
}

function recordProviderLatency(elapsedMs: number): void {
  recentProviderLatencies.push(elapsedMs);
  if (recentProviderLatencies.length > LATENCY_WINDOW) {
    recentProviderLatencies.shift();
  }
}

/**
 * Whether the p95 latency of the last `LATENCY_WINDOW` provider calls exceeds
 * the 6s threshold — the flag that slots into `GatewayContext.latencyDegraded`
 * for the next request. The recording side is in `callProvider`, so this stays
 * in step with the calls the gateway has actually made.
 */
export function isCurrentLatencyDegraded(): boolean {
  return isLatencyDegraded(recentProviderLatencies);
}

/** State threaded through the pipeline stages. */
interface Run {
  ctx: GatewayContext;
  provider: AIProvider;
  req: ProviderRequest;
  /** The request actually sent, with the per-request output cap applied. */
  sentReq: ProviderRequest;
  /** True once the one permitted 429/503 retry has been made. */
  retried: boolean;
  level: AICallLevel;
  startedAt: number;
  elapsedMs: number;
  pending: Promise<ProviderResponse> | null;
  providerResult?: ProviderResponse;
  guardTripped?: string;
  /** A Gemini safety-block reason, recorded distinctly in ai_interactions (F18-T03). */
  blockedReason?: string;
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
// are distinct stages in the ticket's order. The capped request is kept so a
// 429/503 retry re-sends exactly what would have been sent the first time.
async function requestStage(run: Run): Promise<StageDecision> {
  // F12-T04 — the per-request output caps (200 coach, 1500 analysis, §6.4) are
  // a hard ceiling, so even a caller that over-allocates `maxTokens` can never
  // ask the model for more than its purpose allows.
  const capped = Math.min(run.req.maxTokens, perRequestOutputCap(run.ctx.purpose));
  run.sentReq = capped === run.req.maxTokens ? run.req : { ...run.req, maxTokens: capped };
  run.pending = run.provider.request(run.sentReq);
  return CONTINUE;
}

// 5. Timeout and retry — bound the in-flight request (tech_infrastructure
// §6.2; F12-T05 owns the retry policy). A timeout or any non-retriable failure
// falls straight to L2; only a genuine HTTP 429/503 earns one retry, with
// jittered backoff. A timeout is never retried — the respondent is waiting, so
// the first straggler is enough to drop the level. Only one retry happens, and
// a retry that itself times out or fails is also served as L2.
async function timeoutStage(run: Run): Promise<StageDecision> {
  const pending = run.pending;
  if (pending === null) {
    run.elapsedMs = Date.now() - run.startedAt;
    return { kind: "stop", level: "L2", degraded: true };
  }
  const timeoutMs = run.ctx.timeoutMs ?? PROVIDER_TIMEOUT_MS;

  const attempt = await boundAttempt(pending, timeoutMs);
  if (
    attempt.kind === "error" &&
    isRetriableStatus(attempt.error) &&
    !run.retried
  ) {
    // One permitted retry for 429/503, after a jittered backoff.
    run.retried = true;
    await delay(retryBackoffMs(run.ctx.retryBackoffMs));
    const retry = await boundAttempt(run.provider.request(run.sentReq), timeoutMs);
    if (retry.kind === "success") {
      run.providerResult = retry.response;
      run.elapsedMs = Date.now() - run.startedAt;
      return CONTINUE;
    }
    // A retry that fails is not retried again. A safety block on the retry is
    // recorded here, just as it would be on the first attempt (F18-T03).
    run.blockedReason = safetyBlockReason(retry.kind === "error" ? retry.error : undefined);
    run.elapsedMs = Date.now() - run.startedAt;
    return { kind: "stop", level: "L2", degraded: true };
  }

  if (attempt.kind === "success") {
    run.providerResult = attempt.response;
    run.elapsedMs = Date.now() - run.startedAt;
    return CONTINUE;
  }
  // F18-T03 — a safety block is its own signal, carried so the otherwise
  // identical L2 fallback is audited distinctly from a guard trip or an HTTP
  // failure in ai_interactions.blocked_reason.
  run.blockedReason = safetyBlockReason(attempt.kind === "error" ? attempt.error : undefined);
  run.elapsedMs = Date.now() - run.startedAt;
  return { kind: "stop", level: "L2", degraded: true };
}

/** The bounded outcome of one provider call under the §6.2 timeout. */
type BoundAttempt =
  | { kind: "success"; response: ProviderResponse }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown };

/** Run one provider call under the timeout, resolving — never rejecting — to
    its bounded outcome. A timeout is reported as its own case so the retry
    policy can tell "no time left" apart from "the provider refused". */
async function boundAttempt(
  pending: Promise<ProviderResponse>,
  timeoutMs: number,
): Promise<BoundAttempt> {
  return new Promise<BoundAttempt>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    pending.then(
      (response) => {
        clearTimeout(timer);
        resolve({ kind: "success", response });
      },
      (error) => {
        clearTimeout(timer);
        resolve({ kind: "error", error });
      },
    );
  });
}

// 6. Output guard (tech_infrastructure.md §5.4, F13-T03). Coach output is run
// through the full §5.4 guard — banned terms on hint and example, hint ≤25
// words, no digit, and the verdict-sanity rule (an "ok" verdict carries an
// empty hint). A trip discards the model output and serves the deterministic
// sibling; it is never retried — a tripped guard means the prompt is leaking
// and should surface in the log rather than be papered over. The
// facilitator-only purposes are not coach output, so they have no such guard.
async function guardStage(run: Run): Promise<StageDecision> {
  if (run.ctx.purpose !== "coach") return CONTINUE;
  const output = run.providerResult;
  if (output === undefined) return CONTINUE;
  const guarded = guardCoachResponse(output.text);
  if (guarded.kind === "trip") {
    run.guardTripped = guarded.violations.join("; ");
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

// F12-T06 — the `ai_interactions` row (tech_infrastructure.md §3, FR-20). This
// is the second audit leg, alongside the structured log line above: a served
// L0 call records its model, verdict, hint text and real token counts; a
// degraded L2 call records zero tokens but still the level, purpose and model
// the call was aimed at — so the facilitator sees exactly one row per gateway
// call and can audit both the live-model spend and the mid-cohort model pin.
// The mapping is pure (no I/O) so "tokens non-zero for L0, zero for L2" is
// unit-testable without a database; recordModelCall writes the row and the
// token counters in one transaction (F12-T04).
export function gatewayCallRecord(
  ctx: Pick<GatewayContext, "purpose" | "record">,
  req: ProviderRequest,
  result: GatewayResult,
): RecordedModelCall | null {
  const record = ctx.record;
  if (record === undefined) return null;
  return {
    cohortId: record.cohortId,
    respondentId: record.respondentId ?? null,
    questionId: record.questionId ?? null,
    purpose: ctx.purpose,
    attemptNo: record.attemptNo ?? null,
    level: result.level,
    // The model that actually produced the output when one did, or the pinned
    // model the call was aimed at when it was served deterministically — so the
    // audit shows a mid-cohort model change whether or not the model ran.
    model: result.provider?.model ?? req.model,
    verdict: record.verdict ?? null,
    hintText: record.hintText ?? null,
    exampleShown: record.exampleShown ?? false,
    answerChanged: false,
    inputTokens: result.provider?.inputTokens ?? 0,
    outputTokens: result.provider?.outputTokens ?? 0,
    guardTripped: result.guardTripped ?? null,
    // F18-T03 — a Gemini safety block is audited in its own column so a
    // rising block count is visible to the facilitator, separate from the
    // §11 guard-trip metric (`guard_tripped`) and from ordinary HTTP failures
    // (which record nothing here).
    blockedReason: result.blockedReason ?? null,
  };
}

/** Persist one `ai_interactions` row for the call, when a row is wired. */
async function recordRun(run: Run, result: GatewayResult): Promise<void> {
  const record = gatewayCallRecord(run.ctx, run.sentReq, result);
  if (record === null) return;
  try {
    // `record` is non-null exactly when the call carries audit metadata, so
    // `rule.db` is always set here.
    await recordModelCall(run.ctx.record!.db, record);
  } catch {
    // The audit write must never fail the served call — the respondent already
    // has their result and the pipeline guarantee (F12-T01 "never throws")
    // outranks the log row. A lost row surfaces to the facilitator as missing
    // audit data, not as a broken coach; the structured log line above already
    // went out regardless, so §11's signals survive even a db failure here.
  }
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
        blockedReason: run.blockedReason,
      };
    }
  }
  return {
    level: run.level,
    degraded: false,
    guardTripped: run.guardTripped,
    blockedReason: run.blockedReason,
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
    sentReq: req,
    retried: false,
    level: "L0",
    startedAt: Date.now(),
    elapsedMs: 0,
    pending: null,
  };
  let result: GatewayResult;
  try {
    result = await runPipeline(run);
  } catch {
    // An unexpected failure anywhere must never reach a caller (F12-T01).
    // Serve L2, and log it as a guard trip so the §11 metric still counts.
    run.elapsedMs = Date.now() - run.startedAt;
    result = {
      level: "L2",
      degraded: true,
      guardTripped: "gateway_failed",
    };
  }
  if (run.pending !== null) recordProviderLatency(run.elapsedMs);
  // Both audit legs — the structured log line and the ai_interactions row —
  // run exactly once, after the served result is final. The row write is
  // best-effort (F12-T06): a db failure must not undo the result.
  logRun(run, result);
  await recordRun(run, result);
  return result;
}