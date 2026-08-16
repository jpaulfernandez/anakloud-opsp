import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { performSubmit } from "@/lib/submit";

// Submit, snapshot and OPSP generation (F06-T03, FR-14, FR-22,
// tech_infrastructure.md §4). POST /api/submit locks the respondent's answers
// and freezes them, in one transaction, exactly as the reviewer was told in the
// F06-T02 confirmation: identity is the httpOnly session cookie alone, there is
// no body to parse, and idempotency lives in the transaction (a second submit
// for an already-locked respondent returns the existing state rather than
// writing a duplicate snapshot).

export async function POST() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const result = await performSubmit(db, session.respondentId, session.cohortId);
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await db.end();
  }
}