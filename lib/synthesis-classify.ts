// F15-T03 — the compatibility-classification orchestrator (tech_infrastructure.md
// §5.6, FR-39, spec.md §5.6).
//
// This is STEP 1 of a deliberately two-step synthesis. Step 2 (drafting a
// statement when compatible) is F15-T04; this ticket builds classification as
// its own call, with its own logged interaction row, so a synthesis can only
// ever be drafted after a separately-recorded verdict has cleared the
// sources. The "separate step, not part of one call" requirement is structural:
// `buildClassificationProviderRequest` is its own provider request and
// `runClassificationAttempt` goes through the gateway once, which writes
// exactly one ai_interactions row (purpose "synthesis") per call.
//
// The compatibility bar is the whole product of this step: two sources are
// compatible only when they can be stated as one thing without either party
// losing something they said. The prompt and output schema own that definition
// (lib/synthesis-classify-prompt.ts); this module owns the shape of the call
// and the degradation contract.
//
// Degradation (PR3, tech_infrastructure.md §6): the served level decides the
// response exactly like lib/analyse-endpoint.ts. L0 runs the model and parses
// the verdict; every degraded serve (L1 latency, L2/L3 rule-based or plain
// form, budget exhausted, circuit open, key removed) serves the deterministic
// sibling — never an error. There is deliberate NO background retry queue here
// as the analysis endpoints have: classification is an interactive,
// facilitator-triggered decision in the room, so a latency-degraded call simply
// serves the deterministic refusal and the facilitator can retry the button;
// queueing a verdict the canvas would never refresh would only add failure
// modes. The deterministic sibling is a *refusal to combine* (`compatible:
// false` with an honest reason) — the conflict guard's non-negotiable is that a
// synthesis must never be produced from sources whose compatibility was not
// assessed, and "compatible" cannot be defaulted when no model ran.
//
// Privacy (AGENTS.md): the payload is built from the cell's source cards —
// self-contained snapshots of public answers. Only the card's text and question
// metadata reach the model, labelled A/B/C in attachment order; the card's
// respondentId and respondentName never enter the context type, so an identity
// cannot ride into the call. The `ai_interactions` row records cohort/respondent/
// question metadata only, never answer text (F12-T06).
//
// Pure seams: `buildClassificationContext`, `buildClassificationProviderRequest`
// and `buildDeterministicClassification` are pure. `runClassificationAttempt`
// is the gateway-adjacent seam (testable with a fake provider), and
// `serveClassification` decides the response by served level — so the ticket's
// acceptances are unit-testable without a browser, a database or a live model.

import { callProvider, type AIProvider, type GatewayContext, type ProviderRequest } from "./ai-gateway";
import { reportedDeterministicLevel, type AnalysisLabel } from "./analyse-endpoint";
import { perRequestOutputCap } from "./budget";
import type { ResolvedLevel } from "./config";
import { OPSP_CELL_LABELS } from "./opsp-view";
import type { OpspCellId } from "./opsp";
import type { OfficialCell } from "./official-opsp";
import {
  buildClassificationMessages,
  CLASSIFICATION_RESULT_TOOL,
  parseClassificationResponse,
  type ClassificationCardBlock,
  type ClassificationOutput,
  type ClassificationRequestContext,
} from "./synthesis-classify-prompt";

/** The minimum source cards a synthesis request needs before classification runs. */
export const CLASSIFICATION_MIN_CARDS = 2;

/** Thrown when a cell has fewer than the minimum source cards to classify. */
export class SourceCardCountError extends Error {
  constructor() {
    super(`at least ${CLASSIFICATION_MIN_CARDS} source cards are needed to classify a cell`);
    this.name = "SourceCardCountError";
  }
}

/**
 * The short "Q<number>" label used as question metadata on a card payload.
 * Mirrors the attribute label on the canvas; never the raw question id text.
 */
function shortQuestion(id: string): string {
  return id.length > 0 && id[0] === "q" ? `Q${id.slice(1)}` : id.toUpperCase();
}

/**
 * Build the anonymised classification context from an official cell (pure).
 * Requires `CLASSIFICATION_MIN_CARDS` source cards. Each card is anonymised to
 * "Respondent A/B/…" in attachment order and carries only its text and question
 * label — the card's respondentName and respondentId never reach the context,
 * because the privacy rule allows answer text and question metadata only.
 * Throws `SourceCardCountError` when the cell does not yet warrant classification.
 */
export function buildClassificationContext(
  cell: OfficialCell,
  cellId: OpspCellId,
): ClassificationRequestContext {
  if (cell.sourceCards.length < CLASSIFICATION_MIN_CARDS) {
    throw new SourceCardCountError();
  }
  const cards: ClassificationCardBlock[] = cell.sourceCards.map((card, i) => ({
    label: `Respondent ${String.fromCharCode(65 + i)}`,
    question: shortQuestion(card.questionId),
    text: card.text,
  }));
  return { cellId, cellTitle: OPSP_CELL_LABELS[cellId], cards };
}

/** Build the provider request for one classification call (§5.6 structured verdict). */
export function buildClassificationProviderRequest(
  ctx: ClassificationRequestContext,
  model: string,
): ProviderRequest {
  const messages = buildClassificationMessages(ctx);
  return {
    prompt: "",
    model,
    maxTokens: perRequestOutputCap("synthesis"),
    structuredOutput: {
      system: messages.system,
      userMessage: messages.messages[0].content,
      tool: CLASSIFICATION_RESULT_TOOL,
    },
  };
}

/** The outcome of one classification attempt through the gateway. */
export interface ClassificationAttempt {
  /** The level that actually served the attempt. */
  served: "L0" | "L1" | "L2";
  /** The parsed verdict, present exactly when the model ran and it parsed. */
  classification: ClassificationOutput | null;
}

/**
 * Run one classification through the gateway and parse the result. A healthy
 * L0 reply that does not parse as §5.6 structured output is treated as a
 * degraded serve (the parser is the boundary; there is no §5.4 guard
 * downstream). The gateway never throws, so this resolves for every error
 * class the provider can throw — the key-removed case included. Each call
 * through the gateway records one ai_interactions row (purpose "synthesis")
 * when the context carries a `record`.
 */
export async function runClassificationAttempt(
  ctx: ClassificationRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<ClassificationAttempt> {
  const result = await callProvider(
    gateway,
    provider,
    buildClassificationProviderRequest(ctx, model),
  );
  if (result.level === "L0" && !result.degraded && result.provider !== undefined) {
    try {
      return {
        served: "L0",
        classification: parseClassificationResponse(result.provider.text),
      };
    } catch {
      // Not a §5.6-shaped reply despite a clean gateway pass: fall through to
      // the deterministic sibling rather than surface it as a real verdict.
    }
  }
  return { served: result.level, classification: null };
}

/**
 * The deterministic sibling for a degraded classification serve (PR3): a
 * refusal to combine. The conflict guard cannot be cleared without a model, so
 * when none served the call we must NOT return "compatible" — a compatible
 * verdict is what lets F15-T04 draft a synthesis, and defaulting it would be
 * the guard being papered over. We therefore refuse, with an honest reason that
 * says the sources were not auto-assessed and should be decided in the room.
 */
export function buildDeterministicClassification(): ClassificationOutput {
  return {
    compatible: false,
    reason:
      "The planner isn't available right now, so compatibility couldn't be assessed automatically. " +
      "These sources should not be combined until someone in the room decides whether they fit.",
  };
}

/** The response to POST /api/admin/synthesise/classify, by served level. */
export type ClassificationServeBody =
  | {
      ok: true;
      level: "L0";
      cellId: OpspCellId;
      classification: ClassificationOutput;
      label: AnalysisLabel;
    }
  | {
      ok: true;
      level: "L2" | "L3";
      cellId: OpspCellId;
      classification: ClassificationOutput;
      label: AnalysisLabel;
    };

/**
 * The single orchestrator the route calls. Runs classification through the
 * gateway, then serves the verdict its served level demands: the model's parse
 * at L0, and the deterministic refusal at any degraded serve (L1's transient
 * latency included — classification does not queue, see the module comment).
 * The reason is served in every branch, because showing it to the facilitator
 * is an acceptance of this ticket. Never throws on AI failure.
 */
export async function serveClassification(
  ctx: ClassificationRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
  servedLevel: ResolvedLevel,
): Promise<ClassificationServeBody> {
  // FR-35: every output carries the pinned model id and a generation timestamp.
  // The deterministic branch clears the model so the label never fabricates one.
  const label: AnalysisLabel = {
    model,
    generatedAt: new Date().toISOString(),
  };

  const attempt = await runClassificationAttempt(ctx, gateway, provider, model);

  if (attempt.served === "L0" && attempt.classification !== null) {
    return {
      ok: true,
      level: "L0",
      cellId: ctx.cellId,
      classification: attempt.classification,
      label,
    };
  }

  return {
    ok: true,
    level: reportedDeterministicLevel(servedLevel),
    cellId: ctx.cellId,
    classification: buildDeterministicClassification(),
    label,
  };
}