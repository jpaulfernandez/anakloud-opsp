import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { aiApiKey } from "@/lib/config";
import { anthropicProvider } from "@/lib/ai-gateway";
import { buildAnalysisGatewayContext } from "@/lib/analyse-endpoint";
import {
  buildOpspAnalysisContextFromCells,
  loadIndividualDraftForOwner,
  serveOpspAnalysis,
  runOpspAnalysisAttempt,
} from "@/lib/opsp-analysis";
import type { AnalysisQueueWork } from "@/lib/analysis-queue";
import type { OpspAnalysisOutput } from "@/lib/opsp-analysis-prompt";

// F14-T04 — the individual-OPSP strengths/gaps endpoint (`POST
// /api/admin/opsp-analysis`, FR-33, spec.md §6.4).
//
// Accepts `{ respondent_id }` — the owner of the OPSP to analyse — behind the
// F09-T01 admin gate. It loads that respondent's latest individual OPSP draft
// under the facilitator's RLS context, builds the anonymised FR-33 payload
// (which structurally excludes the q14d private row), runs it through the
// gateway, and serves the body its served level demands (FR-32's degradation,
// mirrored from F14-T02): the full read at L0, a queued-plus-structural body at
// L1, and the deterministic structural summary at L2/L3. The key-removed case
// is the L2 path, so the endpoint returns a labelled 200 rather than an error.
//
// The route is only mounted under `/api/admin/*`, so no respondent ever reaches
// it for their own OPSP: a non-facilitator or an unsubmitted facilitator gets
// 401/403 from the gate before the draft is ever loaded, and the respondent's
// own OPSP routes (`/api/opsp/:id`) never surface this read. Every output is
// labelled with the pinned model and a timestamp and marked as prep material
// (FR-35, ui_ux.md §4.19).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!isRecord(body)) return badRequest();
  const rawOwner = (body as { respondent_id?: unknown }).respondent_id;
  if (typeof rawOwner !== "string" || rawOwner.length === 0) return badRequest();

  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    // The owner read runs as the facilitator, so `drafts_facilitator_read`
    // (F01-T04) bounds it to the caller's own cohort. A missing draft — the
    // owner never submitted, or is outside the cohort — is a resource miss,
    // not an AI failure, so it is a plain 404.
    const draft = await loadIndividualDraftForOwner(
      db,
      respondentId,
      cohortId,
      rawOwner,
    );
    if (draft === null) return notFound();

    const { gateway, servedLevel } = await buildAnalysisGatewayContext(
      db,
      { cohortId, respondentId },
      null,
    );
    const model = process.env.AI_MODEL ?? "";
    const provider = anthropicProvider(aiApiKey());
    const ownerLabel = "A";

    // F14-T02's L1 contract: a transient degradation queues the read and it
    // completes in the background without user action. The retry re-runs the
    // already-built anonymised context (pure data, free of private rows) on a
    // fresh connection — the request-scoped `db` below is never touched by the
    // queued work.
    const ctx = buildOpspAnalysisContextFromCells(draft.cells, ownerLabel, draft.version);
    const jobKey = `${cohortId}:opsp:${rawOwner}`;
    const worker: AnalysisQueueWork<OpspAnalysisOutput> = async () => {
      const workerDb = createDbClient();
      await workerDb.connect();
      try {
        const { gateway: workerGateway } = await buildAnalysisGatewayContext(
          workerDb,
          { cohortId, respondentId },
          null,
        );
        const attempt = await runOpspAnalysisAttempt(
          ctx,
          workerGateway,
          anthropicProvider(aiApiKey()),
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

    const served = await serveOpspAnalysis(
      gateway,
      provider,
      model,
      servedLevel,
      jobKey,
      worker,
      draft,
      ownerLabel,
    );
    return NextResponse.json(served);
  } finally {
    await db.end();
  }
}