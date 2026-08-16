import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { fetchQuestionComparison, parseComparisonMode } from "@/lib/comparison";
import { QUESTION_IDS, type QuestionId } from "@/lib/questions";

// F10-T02 — the comparison data endpoint (tech_infrastructure.md §4).
//
// GET /api/admin/question/:qid returns every respondent's answer to that
// question plus its deterministic divergence result, for the facilitator's own
// cohort. The F09-T01 gate admits only a submitted facilitator; the id comes
// from the URL confirm that :qid is a real question before anything else. The
// private-note row is served by no route, and this one is no exception: q14d
// is not a question id, so it is a 404 long before the answer query runs —
// making "q14d is never returned by this route" a property of the route, not a
// filter that correctness depends on. Within a valid question, private rows
// are excluded at the query layer (lib/comparison.ts).

/** Whether a path segment is one of the fifteen stable question ids. */
function isQuestionId(id: string): id is QuestionId {
  return (QUESTION_IDS as readonly string[]).includes(id);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ qid: string }> },
) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    const { qid } = await params;
    if (!isQuestionId(qid)) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    // The mode is a query value, parsed against the fail-safe default: anything
    // not exactly "attributed" serves no names (lib/comparison.ts).
    const mode = parseComparisonMode(
      new URL(request.url).searchParams.get("mode"),
    );

    const comparison = await fetchQuestionComparison(
      db,
      respondentId,
      cohortId,
      qid,
      mode,
    );
    return NextResponse.json({ ok: true, ...comparison });
  } finally {
    await db.end();
  }
}