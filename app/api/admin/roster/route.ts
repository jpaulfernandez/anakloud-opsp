import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { fetchRoster } from "@/lib/roster";

// F09-T03 — the roster endpoint (FR-29, ui_ux.md §4.17).
//
// GET /api/admin/roster returns who has been invited / started / finished,
// progress, last activity and time spent for the facilitator's own cohort — and
// no answer content. The query selects respondent metadata and answer
// *aggregates* only, never `answers.value`, so the response payload cannot
// carry answer text by construction (the F09-T03 acceptance asserts exactly
// that: no answer text in the response payload, not merely in the rendered
// view). The cohort id comes from requireAdminSession's DB-resolved session,
// never from the request, so a fetches only their own cohort and only after the
// F09-T01 gate has admitted a submitted facilitator.
//
// `fetchRoster` runs inside the facilitator's RLS context, which is what makes
// the cohort-wide answer aggregates visible; reaching this code at all means
// the gate already confirmed submitted + facilitator (FR-28).

export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    const roster = await fetchRoster(db, respondentId, cohortId);
    return NextResponse.json({ ok: true, roster });
  } finally {
    await db.end();
  }
}