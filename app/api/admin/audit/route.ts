import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { fetchContaminationAudit } from "@/lib/contamination";

// F13-T06 — the contamination audit endpoint (spec.md FR-20,
// tech_infrastructure.md §3). The facilitator reads, for their own cohort,
// whether coached answers converged more than uncoached ones. Gated by the
// submitted-facilitator gate (F09-T01) and scoped to the session's own cohort,
// so the result is only ever surfaced after the cohort's answers are in and a
// facilitator is looking at it — never to a respondent, and never for a cohort
// the session does not belong to.
//
// The audit is a pure, deterministic computation over the `ai_interactions`
// log and the divergence scorer (F10-T01): no model is consulted here, so this
// endpoint is provider-free by construction and costs no tokens.

export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;

    const audit = await fetchContaminationAudit(
      db,
      auth.session.respondentId,
      auth.session.cohortId,
    );
    return NextResponse.json({ ok: true, audit });
  } finally {
    await db.end();
  }
}