import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import {
  listOfficialSnapshots,
  parseOfficialSnapshotLabel,
  takeOfficialSnapshot,
} from "@/lib/official-opsp";

// F15-T07 — named version snapshots of the official OPSP (FR-42,
// tech_infrastructure §4). A snapshot records the current plan under a name
// (e.g. "Q4 2026 v1") as a new, immutable `opsp_drafts` version; the
// versioning contract (every official write is an insert, never an update)
// guarantees a snapshot is never modified after it is taken.
//
//   GET   /api/admin/official-opsp/snapshots   the cohort's named snapshots, newest first
//   POST  /api/admin/official-opsp/snapshots   record today's plan under `{ label }`
//
// Both are gated by the submitted-facilitator gate (F09-T01) and scoped to the
// session's own cohort. Taking a snapshot is a plan write, so it is refused on
// a closed cohort (rejectIfCohortReadOnly); listing history stays available.

/** The one, reason-free 400 for a missing or malformed label body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/** The cohort's named snapshot history (F15-T07 acceptance: version history). */
export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const snapshots = await listOfficialSnapshots(
      db,
      session.respondentId,
      session.cohortId,
    );
    return NextResponse.json({ ok: true, snapshots });
  } finally {
    await db.end();
  }
}

/**
 * Take a named snapshot of the current official plan. The label is validated
 * and trimmed; the snapshot is written as a new immutable version. Cohort is
 * the session's own — a facilitator can only ever snapshot their own plan.
 */
export async function POST(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const readOnly = rejectIfCohortReadOnly(session);
    if (readOnly) return readOnly;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }
    const label = parseOfficialSnapshotLabel(
      (body as { label?: unknown } | null)?.label,
    );
    if (label === null) return badRequest();

    const snapshot = await takeOfficialSnapshot(
      db,
      session.respondentId,
      session.cohortId,
      label,
    );
    return NextResponse.json({ ok: true, snapshot });
  } finally {
    await db.end();
  }
}