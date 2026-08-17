import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { getOfficialSnapshot } from "@/lib/official-opsp";

// F15-T07 — fetch one named snapshot of the official OPSP (FR-42,
// tech_infrastructure §4). GET /api/admin/official-opsp/snapshots/:version
// returns the plan exactly as it was when that snapshot was taken, for a
// read-only look back at the version history. Admin-gated and scoped to the
// session's own cohort, and only a row with a name (a snapshot, not a plain
// working version) resolves.

function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string }> },
) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const raw = (await params).version;
    const version = Number(raw);
    if (!Number.isInteger(version) || version <= 0) return notFound();

    const snapshot = await getOfficialSnapshot(
      db,
      session.respondentId,
      session.cohortId,
      version,
    );
    if (!snapshot) return notFound();
    return NextResponse.json({ ok: true, snapshot });
  } finally {
    await db.end();
  }
}