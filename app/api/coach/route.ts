import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { withRespondentContext } from "@/lib/access";
import { isQuestionId } from "@/lib/answer-shape";
import type { QuestionId } from "@/lib/questions";
import { loadCoachRequest } from "@/lib/coach-request";
import { aiApiKey } from "@/lib/config";
import { anthropicProvider } from "@/lib/ai-gateway";
import {
  buildCoachGatewayContext,
  degradedCoachBody,
  serveCoach,
} from "@/lib/coach-endpoint";

// The AI coach endpoint (F13-T04, tech_infrastructure.md §4, §6.2, spec.md §7,
// §10 criterion 7; PR3, PR6).
//
// POST /api/coach   body: { question_id, example_requested? }
//
// The endpoint is the model-driven half of the coach. It resolves the ONE
// stored answer for the session's respondent + question (via loadCoachRequest,
// which reads through listPublicAnswers so a private Q14(d) note can never
// reach a payload — F13-T02), then runs it through the gateway. Whatever the
// outcome — a served L0 hint, a 6s timeout, a guard trip, an exhausted budget,
// a circuit-open stop or any provider error — the response is a valid coach
// body and the status is never a 5xx. The body carries `level` for logging;
// the UI must not surface it.
//
// The respondent is identified solely by the session cookie; a question_id in
// the body is the only thing the client supplies, and no answer text is ever
// accepted from the client (it is read server-side). There is no error, retry
// control or spinner on the other end: a degraded response is a normal coach
// card with a fixed hint (PR6).

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export async function POST(request: Request): Promise<Response> {
  // Capture the validated question id up front so the outermost fallback below
  // can still attach the right static hint if something throws after parsing.
  let questionId: QuestionId | null = null;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!isRecord(body) || !isQuestionId(body.question_id)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // `body.question_id` is narrowed to QuestionId by the guard above; bind it
    // to a local non-null const for the closure-safe call below.
    const qid: QuestionId = body.question_id;
    questionId = qid;
    const exampleRequested = body.example_requested === true;

    const db = createDbClient();
    await db.connect();
    try {
      const auth = await requireApiSession(db);
      if (!auth.ok) return auth.response;
      const session = auth.session;

      // Resolve the single answer within the respondent's RLS scope (F13-T02
      // payload minimisation runs here); the gateway context is built on the
      // plain connection since ai_budget/cohorts are not RLS-gated.
      const req = await withRespondentContext(db, session.respondentId, (tx) =>
        loadCoachRequest(tx, session.respondentId, qid, exampleRequested),
      );
      const ctx = await buildCoachGatewayContext(
        db,
        session,
        qid,
        exampleRequested,
      );

      const model = process.env.AI_MODEL ?? "";
      const provider = anthropicProvider(aiApiKey());
      return NextResponse.json(await serveCoach(req, ctx, provider, model));
    } finally {
      await db.end();
    }
  } catch {
    // F13-T04: `/api/coach` SHALL NOT return a 5xx under any condition. The
    // gateway already guarantees the provider path resolves rather than throws
    // (F12-T01), so this edge only fires on an environment or database fault —
    // and even then the respondent sees a normal deterministic L2 coach card
    // instead of an error surface (PR6).
    return NextResponse.json(degradedCoachBody(questionId));
  }
}