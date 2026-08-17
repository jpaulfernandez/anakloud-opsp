import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { parseOpspEdit } from "@/lib/opsp-edit";
import {
  createOfficialDraftVersion,
  getOrCreateOfficialDraft,
} from "@/lib/official-opsp";

// The official OPSP canvas API (F15-T01, FR-36, ui_ux.md §4.20). The official
// draft lives at /api/admin/official-opsp because it is a facilitator tool,
// scoped to the session's own cohort (no client-supplied cohortId is ever
// read). Every handler is gated by the submitted-facilitator gate (F09-T01)
// and, inside, runs with the facilitator's RLS context so the 0011 official
// policies admit exactly the authoring this route performs and nothing else.
//
//   GET    /api/admin/official-opsp   the cohort's official draft (created on
//                                     first open as a blank version 1)
//   PATCH  /api/admin/official-opsp   author one cell → a new draft version
//
// The PATCH write appends a new opsp_drafts version through
// createOfficialDraftVersion — the answers table is never touched.

/** The one, reason-free 400 for a malformed or wrong-shaped edit body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/** Read (and lazily create) the cohort's official draft for the facilitator. */
export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const draft = await getOrCreateOfficialDraft(
      db,
      session.respondentId,
      session.cohortId,
    );
    return NextResponse.json({
      ok: true,
      id: draft.id,
      version: draft.version,
      cells: draft.cells,
      cohortId: session.cohortId,
    });
  } finally {
    await db.end();
  }
}

/**
 * Author one cell of the official plan. A closed cohort is read-only
 * (ui_ux.md §6), so this write is refused there; reading (GET) still works.
 * The edit is validated and applied as a new draft version. The route never
 * returns answers content, and the cohortId is the session's own.
 */
export async function PATCH(request: Request) {
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
    const edit = parseOpspEdit(body);
    if (!edit) return badRequest();

    // Ensure a version-1 baseline exists, then author a new version from it.
    await getOrCreateOfficialDraft(db, session.respondentId, session.cohortId);
    const result = await createOfficialDraftVersion(
      db,
      session.respondentId,
      session.cohortId,
      edit,
    );

    return NextResponse.json({
      ok: true,
      version: result.version,
      cells: result.cells,
    });
  } finally {
    await db.end();
  }
}