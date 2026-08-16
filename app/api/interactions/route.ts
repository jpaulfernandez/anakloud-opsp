import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { isQuestionId } from "@/lib/answer-shape";
import { logCoachInteraction, setExampleShown } from "@/lib/interactions";

// Coach interaction logging endpoint (F05-T05, spec.md FR-20,
// tech_infrastructure.md §3).
//
// POST /api/interactions — called by the coach shell in the browser each time a
// coach interaction happens:
//   - kind "coach": a nudge card was shown → write one `ai_interactions` row
//     with the question, attempt number, verdict, hint text and level;
//   - kind "example": an example was requested against the current nudge → flip
//     `example_shown` on its row.
//
// This is the deterministic L2 coach (PR3), so the level is recorded server-side
// as L2 and never accepted from the client — the caller cannot claim any other
// level. The body carries coach content only (hint text, question id, attempt
// number); it SHALL NOT and does not accept answer text, respondent names,
// emails or ids, which is what keeps "no answer text in application logs" true
// even though this is the one place coach content is retained. Identity and
// ownership come from the session cookie; a respondent only ever logs their own
// interactions.

type RequestBody = {
  kind: "coach" | "example";
  question_id?: unknown;
  attempt_no?: unknown;
  verdict?: unknown;
  hint_text?: unknown;
};

export async function POST(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return badRequest();
    }
    if (!isRecord(body)) return badRequest();

    if (body.kind === "coach") {
      if (
        !isQuestionId(body.question_id) ||
        !isAttemptNo(body.attempt_no) ||
        !isNonEmptyString(body.verdict) ||
        !isNonEmptyString(body.hint_text)
      ) {
        return badRequest();
      }
      // The deterministic coach always serves at L2. Hard-coded here rather
      // than read from the body so the level recorded reflects what actually
      // served the interaction, never what the client claims.
      await logCoachInteraction(db, session.respondentId, {
        question_id: body.question_id,
        attempt_no: body.attempt_no,
        verdict: body.verdict,
        hint_text: body.hint_text,
        example_shown: false,
        level: "L2",
      });
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "example") {
      if (!isQuestionId(body.question_id)) return badRequest();
      await setExampleShown(db, session.respondentId, body.question_id);
      return NextResponse.json({ ok: true });
    }

    return badRequest();
  } finally {
    await db.end();
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isAttemptNo(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 3;
}

/** The single, reason-free 400 for a malformed or wrong-shaped body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}