// F14-T02 — the /api/admin/analyse orchestrator (tech_infrastructure.md §4,
// spec.md §7, FR-32; PR3). The part of the route that is testable without a
// server or a database, mirroring the F13-T04 coach-endpoint split.
//
// The ticket's degradation contract lives here:
//
//   - L0 (model healthy): run the §5.5 analysis through the gateway and serve
//     the parsed, structured read.
//   - L1 (degraded — latency/transient): queue the analysis in the background
//     retry queue (lib/analysis-queue.ts) so it completes without user action,
//     and serve the deterministic divergence scoring now so the facilitator is
//     not left with nothing.
//   - L2/L3 (AI unavailable, budget spent, circuit open, or plain form): never
//     an error — serve the deterministic divergence breakdown and the export
//     options, presented as their own feature rather than as a downgrade
//     (spec.md §7 "the system SHALL NOT return an error when AI is unavailable;
//     it SHALL return the deterministic result").
//
// The analysis payload is the anonymised A/B/C context built by F14-T01
// (lib/analysis-request.ts): no name, email, respondent id, or private row can
// exist in it, because the type cannot hold one and the reads filter
// `is_private` in the SQL. The deterministic scoring keeps the same discipline:
// it is computed from the same public read helpers, so the Q14(d) note never
// reaches either branch.
//
// The served level is resolved from boot config plus the cohort pin
// (resolveServedLevel). In local/preview — and so with the AI key removed — the
// boot default is L2, which is exactly why the key-removal case returns scoring
// and a 200 rather than an error.

import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import {
  listPublicAnswersForCohort,
  listPublicAnswersForQuestion,
} from "./answers";
import {
  classifyDivergence,
  type DivergenceAnswerInput,
  type DivergenceCategory,
  type DivergenceResult,
} from "./divergence";
import { callProvider } from "./ai-gateway";
import type {
  AIProvider,
  GatewayContext,
  ProviderRequest,
} from "./ai-gateway";
import {
  ANALYSIS_RESULT_TOOL,
  buildAnalysisMessages,
  parseAnalysisResponse,
  type AnalysisOutput,
  type AnalysisRequestContext,
} from "./analysis-prompt";
import { enqueueAnalysis } from "./analysis-queue";
import type { AnalysisQueueWork } from "./analysis-queue";
import { perRequestOutputCap, isBudgetExhausted, loadBudget } from "./budget";
import { circuitOpenAt, loadCircuit } from "./circuit";
import { loadConfig, type ResolvedLevel } from "./config";
import { fetchCohortLive, resolveServedLevel } from "./cohort-lifecycle";
import { isCurrentLatencyDegraded, type TargetLevel } from "./ai-gateway";
import { QUESTIONS, type QuestionId } from "./questions";
import type { ResolvedSession } from "./session";

/** Re-exported so the route can load the anonymised prompt context (F14-T01). */
export { loadAnalysisForQuestion, loadAnalysisForCohort } from "./analysis-request";

/** The scope of an analysis request, matching the §5.5 payload. */
export type AnalyseScope = "question" | "cohort";

/** The served level as the response reports it (the gateway only knows L0-L2). */
export type AnalyseServedLevel = "L0" | "L1" | "L2" | "L3";

/**
 * One question's deterministic divergence result as the L2/L3 fallback serves
 * it. A lean, serialisable mirror of DivergenceResult — the facilitator reads
 * where the team aligns and where it doesn't, without a model.
 */
export interface AnalysisScoringResult {
  questionId: QuestionId;
  mode: "open" | "closed";
  included: number;
  privateExcluded: number;
  agreementRate: number | null;
  modalAnswer: string | null;
  spread: number | null;
  meanConfidence: number | null;
  wordCounts: number[] | null;
  lengthSpread: number | null;
  category: DivergenceCategory | "manual review" | null;
}

/**
 * The deterministic fallback the L1/L2/L3 responses serve: a divergence
 * breakdown for the scope plus the export options the facilitator has — the
 * CSV route and the projection sheet. "Presented as its own feature rather than
 * as a downgrade" (ui_ux.md §4.19) starts here, in the shape of the response.
 */
export interface AnalysisScoring {
  scope: AnalyseScope;
  questionId: QuestionId | null;
  results: AnalysisScoringResult[];
  exportOptions: {
    csv: "/api/admin/export";
    projection: "/admin/projection";
  };
}

/** The response to POST /api/admin/analyse, by served level. */
export type AnalysisServeBody =
  | {
      ok: true;
      level: "L0";
      scope: AnalyseScope;
      questionId: QuestionId | null;
      analysis: AnalysisOutput;
    }
  | {
      ok: true;
      level: "L1";
      scope: AnalyseScope;
      questionId: QuestionId | null;
      queued: true;
      scoring: AnalysisScoring;
    }
  | {
      ok: true;
      level: "L2" | "L3";
      scope: AnalyseScope;
      questionId: QuestionId | null;
      scoring: AnalysisScoring;
    };

/**
 * Map the resolved served level to the gateway pin. L3 — the plain-form mode —
 * still produces a deterministic result, so it maps onto the gateway's L2
 * (the same mapping the coach uses); `auto` lets the runtime pick from health
 * flags.
 */
export function gatewayPinForServedLevel(
  served: ResolvedLevel,
): TargetLevel {
  if (served === "L0" || served === "L1" || served === "L2") return served;
  if (served === "auto") return "auto";
  return "L2";
}

/** The reported level for a deterministic serve: L3 stays L3, else L2. */
export function reportedDeterministicLevel(served: ResolvedLevel): "L2" | "L3" {
  return served === "L3" ? "L3" : "L2";
}

/** Build the provider request for one analysis call (forced §5.5 tool, 1500 cap). */
export function buildAnalysisProviderRequest(
  ctx: AnalysisRequestContext,
  model: string,
): ProviderRequest {
  const messages = buildAnalysisMessages(ctx);
  return {
    prompt: "",
    model,
    maxTokens: perRequestOutputCap("analysis"),
    structuredOutput: {
      system: messages.system,
      userMessage: messages.messages[0].content,
      tool: ANALYSIS_RESULT_TOOL,
    },
  };
}

/** The outcome of one analysis attempt through the gateway. */
export interface AnalysisAttempt {
  /** The level that actually served the attempt. */
  served: "L0" | "L1" | "L2";
  /** The parsed §5.5 output, present exactly when the model ran and it parsed. */
  analysis: AnalysisOutput | null;
}

/**
 * Run one analysis through the gateway and parse the result. A healthy L0
 * reply that does not parse as §5.5 structured output is treated as a degraded
 * serve (there is no §5.4 guard downstream, so the parser is the boundary). The
 * gateway never throws, so this resolves for every error class the provider can
 * throw — the key-removed case included.
 */
export async function runAnalysisAttempt(
  ctx: AnalysisRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<AnalysisAttempt> {
  const result = await callProvider(
    gateway,
    provider,
    buildAnalysisProviderRequest(ctx, model),
  );
  if (result.level === "L0" && !result.degraded && result.provider !== undefined) {
    try {
      return { served: "L0", analysis: parseAnalysisResponse(result.provider.text) };
    } catch {
      // Not a §5.5-shaped reply despite a clean gateway pass: this is a prompt
      // leak the schema did not catch, so it must not reach the facilitator as
      // if it were a real analysis. Fall through to the deterministic sibling.
    }
  }
  return { served: result.level, analysis: null };
}

/**
 * The single orchestrator the route calls. Runs the analysis through the
 * gateway, then serves the body its served level demands: the §5.5 read at L0,
 * a queued-plus-scoring body at L1 (the background retry is handed the
 * `worker`), and the deterministic scoring at L2/L3. `scoringLoader` is called
 * only on the degraded branches, so a healthy L0 request does not pay for a
 * cohort-wide read it never uses. Never throws on AI failure.
 */
export async function serveAnalysis(
  ctx: AnalysisRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
  servedLevel: ResolvedLevel,
  jobKey: string,
  worker: AnalysisQueueWork,
  scoringLoader: () => Promise<AnalysisScoring>,
): Promise<AnalysisServeBody> {
  const attempt = await runAnalysisAttempt(ctx, gateway, provider, model);

  if (attempt.served === "L0" && attempt.analysis !== null) {
    return {
      ok: true,
      level: "L0",
      scope: ctx.scope,
      questionId: ctx.questionId,
      analysis: attempt.analysis,
    };
  }

  const scoring = await scoringLoader();

  if (attempt.served === "L1") {
    // Transient degradation: serve the deterministic read now and retry the
    // model in the background so the queued analysis completes on its own.
    enqueueAnalysis({ key: jobKey, work: worker });
    return {
      ok: true,
      level: "L1",
      scope: ctx.scope,
      questionId: ctx.questionId,
      queued: true,
      scoring,
    };
  }

  return {
    ok: true,
    level: reportedDeterministicLevel(servedLevel),
    scope: ctx.scope,
    questionId: ctx.questionId,
    scoring,
  };
}

/** Shape one divergence result into the serialisable scoring block. */
export function analysisScoringResult(d: DivergenceResult): AnalysisScoringResult {
  return {
    questionId: d.questionId,
    mode: d.mode,
    included: d.included,
    privateExcluded: d.privateExcluded,
    agreementRate: d.agreementRate,
    modalAnswer: d.modalAnswer,
    spread: d.spread,
    meanConfidence: d.meanConfidence,
    wordCounts: d.wordCounts,
    lengthSpread: d.lengthSpread,
    category: d.category,
  };
}

/** Shape a list of divergence results into the L2/L3 scoring block. Pure. */
export function analysisScoringBody(
  scope: AnalyseScope,
  questionId: QuestionId | null,
  results: readonly DivergenceResult[],
): AnalysisScoring {
  return {
    scope,
    questionId,
    results: results.map(analysisScoringResult),
    exportOptions: { csv: "/api/admin/export", projection: "/admin/projection" },
  };
}

/**
 * Resolve the served level and build the gateway context for one analysis
 * call, reading the cohort's live pin, budget, circuit and recent latency —
 * the same signals the coach endpoint uses (tech_infrastructure.md §6.1). The
 * pin is derived from `resolveServedLevel`, mapping L3 onto the gateway's L2;
 * budget exhaustion, an open circuit and a latency spike cannot push *below*
 * what the pin chose. Returns the gateway context plus the resolved served
 * level so the route can label a deterministic response accurately.
 */
export async function buildAnalysisGatewayContext(
  db: ClientBase,
  session: Pick<ResolvedSession, "cohortId" | "respondentId">,
  questionId: QuestionId | null,
): Promise<{ gateway: GatewayContext; servedLevel: ResolvedLevel }> {
  const cohort = await fetchCohortLive(db, session.cohortId);
  const servedLevel = resolveServedLevel(
    loadConfig().aiLevel,
    cohort?.aiLevelPin ?? null,
  );
  const pin: TargetLevel = gatewayPinForServedLevel(servedLevel);

  const budget = await loadBudget(db, session.cohortId);
  const budgetExhausted = budget !== null && isBudgetExhausted(budget);
  const circuit = await loadCircuit(db, session.cohortId);
  const circuitOpen = circuitOpenAt(circuit, Date.now());

  return {
    gateway: {
      purpose: "analysis",
      pin,
      budgetExhausted,
      circuitOpen,
      latencyDegraded: isCurrentLatencyDegraded(),
      // F12-T06: one ai_interactions row per call, annotated identity-only and
      // with the analysis-purpose token cap; no answer text or private row is
      // written to the audit row.
      record: {
        db,
        cohortId: session.cohortId,
        respondentId: session.respondentId,
        questionId,
      },
    },
    servedLevel,
  };
}

/** The question definitions the cohort scope iterates, in stable registry order. */
const QUESTION_IDS = QUESTIONS.map((q) => q.id);

/**
 * The deterministic divergence breakdown for an analysis request: one result
 * for a single question, or one per answered question for the whole cohort.
 * Reads through the public helpers so private rows are excluded in the SQL
 * (F01-T03) and runs inside the facilitator's RLS context so cohort-wide
 * answers are visible. Empty results (no answers yet) still produce a valid
 * 200 — this is a scoring read, never an error.
 */
export async function loadAnalysisScoring(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  questionId: QuestionId | null,
): Promise<AnalysisScoring> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    if (questionId !== null) {
      const answers = await listPublicAnswersForQuestion(tx, cohortId, questionId);
      const result = classifyDivergence(
        questionId,
        answers.map((a): DivergenceAnswerInput => ({
          value: a.value,
          confidence: a.confidence,
          is_private: false,
        })),
      );
      return analysisScoringBody("question", questionId, [result]);
    }

    const answers = await listPublicAnswersForCohort(tx, cohortId);
    const byQuestion = new Map<QuestionId, DivergenceAnswerInput[]>();
    for (const a of answers) {
      const qid = a.question_id as QuestionId;
      const bucket = byQuestion.get(qid);
      if (bucket === undefined) byQuestion.set(qid, []);
      byQuestion.get(qid)!.push({
        value: a.value,
        confidence: a.confidence,
        is_private: false,
      });
    }
    // Stable registry order, so repeated loads shape deterministic results.
    const results = QUESTION_IDS
      .filter((qid) => byQuestion.has(qid))
      .map((qid) => classifyDivergence(qid, byQuestion.get(qid)!));

    return analysisScoringBody("cohort", null, results);
  });
}