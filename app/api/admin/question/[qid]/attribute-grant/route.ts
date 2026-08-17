import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { isQuestionId } from "@/lib/answer-shape";
import { createAttributeGrant } from "@/lib/attribute-grant";

// F14-T05 — the attribute-grant endpoint (FR-30, ui_ux.md §4.18, spec.md §10
// criterion 12).
//
// POST /api/admin/question/:qid/attribute-grant hands a submitted facilitator a
// short-lived, signed grant to view *named* answers for one question. It is the
// one way the comparison screen may leave anonymised mode, and it exists so the
// attributed data path has a server capability behind it — the F10-T04
// confirmation is a client-side dialog, and before F14-T05 it was the *only*
// gate. Now the client calls this endpoint only after the facilitator passes
// that confirmation, and the comparison GET refuses named answers without the
// returned grant (lib/attribute-grant.ts). The grant is scoped to exactly this
// facilitator, this cohort and this question, and expires in a few minutes, so
// it never persists across a load, a navigation or a session.
//
// It is gate-identical to the rest of `/api/admin/*`: only a submitted
// facilitator is admitted (F09-T01), and the id comes from the URL with the
// same `:qid` validation every comparison route applies, so a request for a
// question that does not exist is a 404. No answer content is read here — the
// endpoint only signs a capability — so nothing nameable touches this route's
// data path.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ qid: string }> },
): Promise<Response> {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;

    const { qid } = await params;
    if (!isQuestionId(qid)) {
      return NextResponse.json({ ok: false }, { status: 404 });
    }

    const grant = createAttributeGrant({
      respondentId: auth.session.respondentId,
      cohortId: auth.session.cohortId,
      qid,
    });
    return NextResponse.json({ ok: true, grant });
  } finally {
    await db.end();
  }
}