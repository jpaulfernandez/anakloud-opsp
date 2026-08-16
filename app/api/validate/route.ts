import { NextResponse } from "next/server";
import { validators, type Verdict } from "@/lib/validators";
import { STATIC_HINTS, type StaticHint } from "@/lib/static-hints";
import { isQuestionId } from "@/lib/answer-shape";

// The validation endpoint (F05-T03, tech_infrastructure.md §4). POST
// /api/validate returns the deterministic `Verdict` for one answer.
//
// This is the product's always-on core: it is pure local computation with no
// database and no AI of any kind. Its only imports are the pure validator
// modules, so it works identically at every degradation level including L3 and
// with ANTHROPIC_API_KEY absent entirely — there is no code path from here to
// any provider call, by construction.
//
// Unlike the other API routes, no session is required. The endpoint touches no
// stored row and surfaces nothing private: the request is a respondent's own
// in-flight answer and the response is the static verdict + a fixed hint that
// is the same for everyone. Requiring auth here would mean a database lookup,
// which would be the first dependency that is not local computation and would
// make "always available" weaker than it can be.

interface ValidateBody {
  question_id: unknown;
  value: unknown;
}

export async function POST(request: Request) {
  let body: ValidateBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!isRecord(body) || !isQuestionId(body.question_id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const verdict = validators[body.question_id](body.value);
  const response: Verdict = { ok: verdict.ok };
  if (verdict.dimension !== undefined) response.dimension = verdict.dimension;
  if (!verdict.ok) {
    // Every failing validator belongs to a validated question, and every
    // validated question carries a static hint (F05-T02) — so a failing answer
    // always has a fixed hint to attach. Examples are served only on explicit
    // request by the coach shell (F05-T04), never injected here.
    const staticHint = (STATIC_HINTS as Record<string, StaticHint | undefined>)[
      body.question_id
    ];
    if (staticHint !== undefined) response.hint = staticHint.hint;
  }
  return NextResponse.json(response);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}