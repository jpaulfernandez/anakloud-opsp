import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { getOrCreateOfficialDraft } from "@/lib/official-opsp";
import {
  attachSourceCard,
  listSourceCardCandidates,
  parseAttachInput,
  parseRemoveInput,
  removeSourceCard,
  SourceCardUnavailableError,
} from "@/lib/official-source-cards";

// Source cards (F15-T02, FR-37, ui_ux.md §4.20), the facilitator-facing picker
// at /api/admin/official-opsp/source-cards. The route is admin-gated like the
// official draft itself, and the read/write helpers run in the facilitator's
// RLS context so authoring is restricted to the cohort's facilitator. The
// picker pool and every attach are scoped to the session's own cohort — no
// client-supplied cohortId is ever read.
//
//   GET    /api/admin/official-opsp/source-cards   every non-private answer for
//                                                  the picker (never q14d)
//   POST   /api/admin/official-opsp/source-cards   attach an answer as a card →
//                                                  a new official-draft version
//   DELETE /api/admin/official-opsp/source-cards   remove a card → a new version
//
// None of these writes touch the answers table; the only write is a new
// opsp_drafts version (PR5), so attaching or removing a card leaves the
// underlying answer untouched.

/** The one, reason-free 400 for a malformed or wrong-shaped body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/** The picker pool for the facilitator's cohort. */
export async function GET() {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const candidates = await listSourceCardCandidates(
      db,
      session.respondentId,
      session.cohortId,
    );
    return NextResponse.json({ ok: true, candidates });
  } finally {
    await db.end();
  }
}

/** Attach a respondent's answer to a cell. A closed cohort is read-only. */
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
    const input = parseAttachInput(body);
    if (!input) return badRequest();

    // Ensure a version-1 baseline exists (as the PATCH route does) so the first
    // card attached before any cell edit still lands on the same lineage.
    await getOrCreateOfficialDraft(db, session.respondentId, session.cohortId);

    try {
      const result = await attachSourceCard(
        db,
        session.respondentId,
        session.cohortId,
        input,
      );
      return NextResponse.json({
        ok: true,
        version: result.version,
        cells: result.cells,
      });
    } catch (err) {
      // The picked answer is absent, foreign to the cohort, or private (e.g. a
      // q14d request) — nothing was written.
      if (err instanceof SourceCardUnavailableError) {
        return NextResponse.json({ ok: false }, { status: 404 });
      }
      throw err;
    }
  } finally {
    await db.end();
  }
}

/** Remove a source card. A closed cohort is read-only. */
export async function DELETE(request: Request) {
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
    const input = parseRemoveInput(body);
    if (!input) return badRequest();

    // Ensure the lineage exists so remove is never a 500 on a fresh cohort.
    await getOrCreateOfficialDraft(db, session.respondentId, session.cohortId);

    const result = await removeSourceCard(
      db,
      session.respondentId,
      session.cohortId,
      input,
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