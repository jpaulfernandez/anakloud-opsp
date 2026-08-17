import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  acceptOfficialCellDraft,
  NoOfficialDraftPendingError,
  OfficialDraftNotFoundError,
} from "@/lib/official-opsp";

// F15-T04 — explicit human acceptance of a pending AI draft (`POST
// /api/admin/synthesise/accept`, FR-40). A drafted statement lives on the cell
// as a draft and only enters the official OPSP through this deliberate single
// action: it promotes the statement into the cell's published value as ink,
// drops the draft, and records the source questions that fed it as provenance.
// Acceptance is never automatic — there is nothing here that writes a draft
// into the plan without this call.
//
// The route is admin-gated and cohort-write-gated like the synthesis route.
// A cell with no pending draft is a 400 (nothing to accept); a missing
// cell/draft is a 404.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!isRecord(body)) return badRequest();
  const rawCell = (body as { cellId?: unknown }).cellId;
  if (
    typeof rawCell !== "string" ||
    !(OPSP_CELL_IDS as readonly string[]).includes(rawCell)
  ) {
    return badRequest();
  }
  const cellId = rawCell as OpspCellId;

  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const readOnly = rejectIfCohortReadOnly(session);
    if (readOnly) return readOnly;

    try {
      const result = await acceptOfficialCellDraft(
        db,
        session.respondentId,
        session.cohortId,
        cellId,
      );
      return NextResponse.json({ ok: true, version: result.version, cells: result.cells });
    } catch (err) {
      if (err instanceof NoOfficialDraftPendingError) return badRequest();
      if (err instanceof OfficialDraftNotFoundError) return notFound();
      throw err;
    }
  } finally {
    await db.end();
  }
}