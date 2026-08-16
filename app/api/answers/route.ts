import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { withRespondentContext } from "@/lib/access";
import { listOwnAnswers, upsertAnswer } from "@/lib/answers";
import { parseAnswerWriteBody } from "@/lib/answer-shape";

// The answer persistence API (F04-T01, FR-7, tech_infrastructure.md §4).
//
// PATCH /api/answers — upsert one answer for the session's respondent. The
// identity is the httpOnly session cookie alone, exactly as requireApiSession
// enforces everywhere; a `respondent_id` in the body is never read, which is
// the whole of "SHALL NOT accept a respondent_id supplied by the client" (there
// is nowhere in this handler for such a value to enter). The payload shape is
// validated against the question registry before anything reaches Postgres, so
// a wrong-shaped body is rejected with 400 and never written. And if the
// respondent has submitted, the write is refused with 409 before any row is
// touched (PR5 — the answers are immutable once locked).
//
// GET /api/answers — all of the caller's own answers, including their own q14d.
// The single read path that returns private rows, via listOwnAnswers, which
// runs inside the respondent's RLS context so it can never see another
// respondent's rows.

export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const answers = await withRespondentContext(db, session.respondentId, (tx) =>
      listOwnAnswers(tx),
    );
    return NextResponse.json({ ok: true, answers });
  } finally {
    await db.end();
  }
}

export async function PATCH(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }

    // Shape-validated against the registry, and reads only question_id, value
    // and confidence — no respondent id can survive this parse.
    const parsed = parseAnswerWriteBody(body);
    if (!parsed) return badRequest();

    // Lock check first: a submitted respondent's answers are immutable (PR5).
    // The session was resolved live this request, so this reflects the latest
    // lock state; rejecting here leaves every row untouched.
    if (session.submittedAt !== null && session.submittedAt !== undefined) {
      return NextResponse.json({ ok: false, locked: true }, { status: 409 });
    }

    await withRespondentContext(db, session.respondentId, (tx) =>
      upsertAnswer(tx, {
        respondent_id: session.respondentId,
        question_id: parsed.questionId,
        value: parsed.value,
        confidence: parsed.confidence,
      }),
    );
    return NextResponse.json({ ok: true });
  } finally {
    await db.end();
  }
}

/** The single, reason-free 400 for a malformed or wrong-shaped write. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}