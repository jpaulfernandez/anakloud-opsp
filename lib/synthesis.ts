// F15-T04 — the synthesis orchestrator with the conflict guard (tech_
// infrastructure.md §5.6, FR-38, FR-39, FR-40, spec.md §5.6).
//
// This is STEP 2 of the deliberate two-step synthesis: draft one statement for
// a cell whose source cards have been judged compatible. The guard is not
// optional and it is not trusted to the client — `serveSynthesis` re-runs the
// compatibility classification (its own gateway call, its own ai_interactions
// row) before a single token of a draft is produced, and it drafts ONLY when
// that verdict is compatible. There is deliberately no override path, no force
// flag and no "merge anyway" branch anywhere here or in the routes: a synthesis
// from incompatible sources is structurally unproducible because the code
// refuses before the draft call exists.
//
// Degradation (PR3, tech_infrastructure.md §6): the served level decides the
// outcome exactly like lib/analyse-endpoint.ts and the classification step.
// L0 runs the model and parses the verdict/statement; every degraded serve
// refuses — never an error, never a guess. Specifically:
//   - if classification did not clear as compatible (a genuine incompatible
//     verdict, or a degraded L1/L2 serve where no model ran), we refuse and
//     serve the conflict: the incompatible reason when there is one (which
//     states both positions in the respondents' own words), or the honest
//     refusal that compatibility couldn't be assessed. Defaulting "compatible"
//     when no model ran would paper over the guard, so we never do it.
//   - if the sources cleared but the draft call refused to parse or degraded,
//     we refuse to write a draft rather than guess the statement.
//
// Privacy (AGENTS.md): the context is built from the cell's source cards —
// self-contained snapshots of public answers — anonymised A/B/C with only the
// question label and text. Names and ids never enter the context, so a
// respondent identity cannot ride into the call. The ai_interactions rows
// record cohort/respondent metadata only, never answer text.
//
// Pure seams: `buildSynthesisProviderRequest` is pure; `runSynthesisAttempt` is
// the gateway-adjacent seam (testable with a fake provider); `serveSynthesis`
// decides by the guard outcome, so the guard's acceptances are unit-testable
// without a browser, a database or a live model.

import { callProvider, type AIProvider, type GatewayContext, type ProviderRequest } from "./ai-gateway";
import type { AnalysisLabel } from "./analyse-endpoint";
import { perRequestOutputCap } from "./budget";
import type { OpspCellId } from "./opsp";
import {
  buildDeterministicClassification,
  runClassificationAttempt,
} from "./synthesis-classify";
import {
  buildSynthesisMessages,
  parseSynthesisResponse,
  SYNTHESIS_RESULT_TOOL,
  type SynthesisOutput,
  type SynthesisRequestContext,
} from "./synthesis-prompt";

/** The minimum source cards the synthesis guard needs before it will draft. */
export const SYNTHESIS_MIN_CARDS = 2;

/** Build the provider request for one synthesis-draft call (§5.6 step 2). */
export function buildSynthesisProviderRequest(
  ctx: SynthesisRequestContext,
  model: string,
): ProviderRequest {
  const messages = buildSynthesisMessages(ctx);
  return {
    prompt: "",
    model,
    maxTokens: perRequestOutputCap("synthesis"),
    structuredOutput: {
      system: messages.system,
      userMessage: messages.messages[0].content,
      tool: SYNTHESIS_RESULT_TOOL,
    },
  };
}

/** The outcome of one synthesis-draft attempt through the gateway. */
export interface SynthesisAttempt {
  /** The level that actually served the attempt. */
  served: "L0" | "L1" | "L2";
  /** The parsed statement, present exactly when the model ran and it parsed. */
  synthesis: SynthesisOutput | null;
}

/**
 * Run one synthesis draft through the gateway and parse the result. A healthy
 * L0 reply that does not parse as a §5.6 statement is treated as a degraded
 * serve (the parser is the boundary; there is no §5.4 guard downstream). The
 * gateway never throws, so this resolves for every error class the provider can
 * throw. Each call records one ai_interactions row (purpose "synthesis").
 */
export async function runSynthesisAttempt(
  ctx: SynthesisRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<SynthesisAttempt> {
  const result = await callProvider(
    gateway,
    provider,
    buildSynthesisProviderRequest(ctx, model),
  );
  if (result.level === "L0" && !result.degraded && result.provider !== undefined) {
    try {
      return {
        served: "L0",
        synthesis: parseSynthesisResponse(result.provider.text),
      };
    } catch {
      // Not a §5.6-shaped statement despite a clean gateway pass: treat as a
      // degraded serve rather than surface a malformed draft.
    }
  }
  return { served: result.level, synthesis: null };
}

/** A successful draft: the statement the orchestrator produced and stamped. */
export interface DraftedSynthesis {
  ok: true;
  status: "drafted";
  cellId: OpspCellId;
  statement: string;
  label: AnalysisLabel;
}

/** A refused synthesis: the conflict the guard returned, never a statement. */
export interface RefusedSynthesis {
  ok: true;
  status: "refused";
  cellId: OpspCellId;
  /** Why it was refused. When genuine conflict, states both positions. */
  reason: string;
  /**
   * True exactly when the refusal comes from a real incompatible verdict — the
   * classification model actually ran and said the sources cannot be combined.
   * Distinguishes a genuine conflict (which enters the F15-T05 decision state)
   * from a degraded serve with no verdict at all, where there is nothing to
   * choose between.
   */
  genuineConflict: boolean;
  label: AnalysisLabel;
}

/** The response to POST /api/admin/synthesise, by which guard step stopped it. */
export type SynthesisServeBody = DraftedSynthesis | RefusedSynthesis;

/**
 * The conflict-guarded orchestrator the route calls. It re-runs the
 * compatibility classification as its own separate gateway call (STEP 1), then
 * drafts ONLY when that cleared as compatible (STEP 2). Refusal to synthesise
 * is returned with the conflict's reason so the facilitator can read both
 * positions before choosing; the route leaves the cell untouched on any refusal.
 */
export async function serveSynthesis(
  ctx: SynthesisRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<SynthesisServeBody> {
  // FR-35: every output carries the pinned model id and a generation timestamp.
  const label: AnalysisLabel = {
    model,
    generatedAt: new Date().toISOString(),
  };

  // STEP 1 — classify (its own gateway call, its own ai_interactions row).
  const classifyAttempt = await runClassificationAttempt(ctx, gateway, provider, model);
  const cleared =
    classifyAttempt.served === "L0" &&
    classifyAttempt.classification?.compatible === true;
  // A genuine conflict is a verdict the model actually produced (L0) that says
  // incompatible. A degraded serve carries no verdict, so it is a refusal, not
  // a conflict the room can choose between.
  const genuineConflict =
    classifyAttempt.served === "L0" &&
    classifyAttempt.classification !== null &&
    classifyAttempt.classification.compatible === false;

  if (!cleared) {
    // The conflict guard. Whether classification returned a genuine
    // incompatible verdict (its reason states both positions) or degraded with
    // no verdict at all, a synthesis must not be produced. There is no flag,
    // parameter or path that changes this.
    const reason =
      classifyAttempt.classification?.reason ??
      buildDeterministicClassification().reason;
    return {
      ok: true,
      status: "refused",
      cellId: ctx.cellId,
      reason,
      genuineConflict,
      label,
    };
  }

  // STEP 2 — synthesise, only because STEP 1 confirmed compatible.
  const draftAttempt = await runSynthesisAttempt(ctx, gateway, provider, model);
  if (draftAttempt.served === "L0" && draftAttempt.synthesis !== null) {
    return {
      ok: true,
      status: "drafted",
      cellId: ctx.cellId,
      statement: draftAttempt.synthesis.statement,
      label,
    };
  }

  // The sources cleared but no statement was produced. Refuse to write a draft
  // rather than guess — this is a transient/rule-based serve, not a conflict.
  return {
    ok: true,
    status: "refused",
    cellId: ctx.cellId,
    reason:
      "The sources were compatible but the planner couldn't draft a statement just now. " +
      "Nothing was written to the cell — retry, or draft it by hand.",
    genuineConflict: false,
    label,
  };
}