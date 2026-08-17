import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  discardOfficialCellDraft,
  NoOfficialDraftPendingError,
  OfficialDraftNotFoundError,
} from "@/lib/official-opsp";

// F15-T04 — decline a pending AI draft (`POST /api/admin/synthesise/discard`,
// FR-40). A drafted statement the facilitator does not want is removed without
// entering the official OPSP: the cell's published value stays exactly as it
// was. Declining is the counterpart of accepting — it is an explicit action,
// and it never promotes a draft into the plan.
//
// Admin-gated and cohort-write-gated like the synthesis route. A cell with no
// pending draft is a 400; a missing cell/draft is a 404.

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
      const result = await discardOfficialCellDraft(
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