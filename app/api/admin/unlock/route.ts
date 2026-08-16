import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { performUnlock, RespondentNotInCohortError } from "@/lib/unlock";

// Facilitator unlock with audit (F06-T05, FR-14).
//
// POST /api/admin/unlock — reopen a submitted respondent. This is the
// deliberate loophole PR5 leaves for a human, so it is gated harder than any
// other route: only a facilitator session is admitted (403 otherwise), the
// identity comes from the httpOnly cookie alone (requireApiSession), and the
// target must be a respondent in the facilitator's own cohort — enforced inside
// performUnlock because respondents is not RLS-gated. It only ever clears the
// lock and stamps the audit; it never touches answer_snapshots, which is what
// keeps an unlock from rewriting the baseline.
//
// The route lives under /api/admin/ so that F09's admin-gate middleware covers
// it once that lands; until then the facilitator check is done here directly.
// The "surface unlock events on the facilitator dashboard" requirement (F06-T05)
// is satisfied by the persisted unlocked_by/unlocked_at audit, which F09's
// roster dashboard reads.

interface UnlockBody {
  respondentId?: unknown;
}

export async function POST(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    // A non-facilitator must not reach the unlock path at all (acceptance).
    if (!session.isFacilitator) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }
    const respondentId = (body as UnlockBody)?.respondentId;
    if (typeof respondentId !== "string" || respondentId === "") {
      return badRequest();
    }

    try {
      const result = await performUnlock(db, session.respondentId, session.cohortId, respondentId);
      return NextResponse.json({ ok: true, ...result });
    } catch (err) {
      if (err instanceof RespondentNotInCohortError) {
        return NextResponse.json({ ok: false }, { status: 404 });
      }
      throw err;
    }
  } finally {
    await db.end();
  }
}

/** The single, reason-free 400 for a missing or malformed body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}