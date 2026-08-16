import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { resolveSession, SESSION_COOKIE } from "@/lib/session";
import { setGroundRulesAcknowledged } from "@/lib/respondent";

// Ground-rules acknowledgement submit (F02-T05, FR-5, ui_ux.md §4.2).
//
// POST /api/respondent/self/ground-rules — records the respondent's one-time
// acknowledgement of the ground rules, gating the first question. Auth is the
// httpOnly session cookie alone; a missing or unverifiable session is 401.
// Acknowledgement is idempotent: re-posting keeps the *first* timestamp, so a
// double-click or a resume never re-gates the respondent. No branch writes a
// respondent identity or value to a log sink.
export async function POST() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  const db = createDbClient();
  await db.connect();
  try {
    const session = await resolveSession(db, token);
    if (!session) return NextResponse.json({ ok: false }, { status: 401 });

    await setGroundRulesAcknowledged(db, session.respondentId);
    return NextResponse.json({ ok: true });
  } finally {
    await db.end();
  }
}