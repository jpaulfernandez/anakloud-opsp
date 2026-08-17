import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { isQuestionId } from "@/lib/answer-shape";
import { withRespondentContext } from "@/lib/access";
import { anthropicProvider } from "@/lib/ai-gateway";
import {
  buildAnalysisGatewayContext,
  loadAnalysisForCohort,
  loadAnalysisForQuestion,
  loadAnalysisScoring,
  runAnalysisAttempt,
  serveAnalysis,
  type AnalysisServeResponse,
} from "@/lib/analyse-endpoint";
import {
  listAnalysisOutputs,
  recordAnalysisOutput,
} from "@/lib/analysis-output-store";
import type { AnalysisQueueWork } from "@/lib/analysis-queue";
import type { AnalysisRequestContext } from "@/lib/analysis-prompt";
import type { QuestionId } from "@/lib/questions";

// F14-T02/F14-T06 — the facilitator-analysis endpoint (tech_infrastructure.md
// §4: `POST /api/admin/analyse`. AI analysis. Degrades to scoring-only).
//
// Accepts a single question (`{ question_id: "q3" }`) or the whole cohort
// (`{}`), behind the F09-T01 admin gate. It resolves the anonymised §5.5
// payload (F14-T01), runs it through the gateway, and serves the body its
// served level demands: the full read at L0, queued-plus-deterministic-scoring
// at L1, and the deterministic divergence breakdown with export options at L2
// and L3. The key-removed case is the L2 path, so the endpoint returns scoring
// and a 200 rather than an error (spec.md §7, PR3).
//
// F14-T06 (FR-35): every serve is persisted to its own durable row and the
// response carries the retained history alongside the fresh output, so a
// re-run never overwrites the previous one and a change in the read stays
// visible. The serve body already carries the level, model and generation
// timestamp on every branch; the store records those and keeps the whole
// output with them.
//
// The privacy posture has nowhere to leak. The payload context is built by
// F14-T01 from the public read helpers (private rows excluded in SQL), and the
// L1 background retry rebuilds it inside a fresh connection using the same
// helpers — so a retry can never reach a private row even though it runs after
// the request's connection is closed. The request's connection is used only for
// the synchronous payload/scoring reads finished before the response returns.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function buildAnalysisContext(
  db: ReturnType<typeof createDbClient>,
  actorRespondentId: string,
  cohortId: string,
  questionId: QuestionId | null,
): Promise<AnalysisRequestContext> {
  return withRespondentContext(db, actorRespondentId, (tx) =>
    questionId !== null
      ? loadAnalysisForQuestion(tx, actorRespondentId, cohortId, questionId)
      : loadAnalysisForCohort(tx, actorRespondentId, cohortId),
  );
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const rawQid = (body as { question_id?: unknown }).question_id;
  let questionId: QuestionId | null = null;
  if (rawQid !== undefined) {
    if (typeof rawQid !== "string" || !isQuestionId(rawQid)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    questionId = rawQid;
  }

  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    const { gateway, servedLevel } = await buildAnalysisGatewayContext(
      db,
      { cohortId, respondentId },
      questionId,
    );
    const ctx = await buildAnalysisContext(db, respondentId, cohortId, questionId);
    const model = process.env.AI_MODEL ?? "";
    const provider = anthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");

    // F14-T02: at L1 the analysis is queued and retried in the background. The
    // retry runs after this request's connection is closed, so it opens its own
    // connection and rebuilds the payload from the same public helpers — the
    // request-scoped `db` below is never touched by the queued work.
    const jobKey = `${cohortId}:${questionId ?? "cohort"}`;
    const worker: AnalysisQueueWork = async () => {
      const workerDb = createDbClient();
      await workerDb.connect();
      try {
        const workerCtx = await buildAnalysisContext(
          workerDb,
          respondentId,
          cohortId,
          questionId,
        );
        const { gateway: workerGateway } = await buildAnalysisGatewayContext(
          workerDb,
          { cohortId, respondentId },
          questionId,
        );
        const attempt = await runAnalysisAttempt(
          workerCtx,
          workerGateway,
          anthropicProvider(process.env.ANTHROPIC_API_KEY ?? ""),
          model,
        );
        if (attempt.served === "L0" && attempt.analysis !== null) {
          return { done: true, output: attempt.analysis };
        }
        return { done: false, output: null };
      } finally {
        await workerDb.end();
      }
    };

    const scoringLoader = () =>
      loadAnalysisScoring(db, respondentId, cohortId, questionId);

    const served = await serveAnalysis(
      ctx,
      gateway,
      provider,
      model,
      servedLevel,
      jobKey,
      worker,
      scoringLoader,
    );

    // F14-T06 (FR-35): retain every serve, then return it alongside the kept
    // history so a re-running facilitator sees the new output against the old
    // ones — nothing is overwritten. The extract + append helpers factor the
    // record shape (level, model, timestamp) and the append rule so they are
    // unit-testable without a database; the writes and reads below are what
    // make the retention durable.
    await recordAnalysisOutput(db, respondentId, cohortId, served);
    const history = await listAnalysisOutputs(
      db,
      respondentId,
      cohortId,
      served.scope,
      served.questionId,
    );

    const response: AnalysisServeResponse = { ...served, history };
    return NextResponse.json(response);
  } finally {
    await db.end();
  }
}