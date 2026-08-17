import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  NoOfficialConflictError,
  OfficialDraftNotFoundError,
  recordOfficialCellDecision,
  UnknownConflictPositionError,
} from "@/lib/official-opsp";

// F15-T05 — record the human decision on a conflict cell (`POST
// /api/admin/synthesise/record-decision`, FR-39, ui_ux.md §4.20). When the
// guard refused to synthesise two positions, the cell holds both side by side
// with a prompt ("These two don't reconcile. Someone has to choose.") and
// exactly one affordance: `[Record the decision]`, which picks one position.
// This route promotes the chosen position into the cell's published content as
// ink and attaches the decision note — which position was chosen and by whom.
// There is deliberately no merge control anywhere: this call only records a
// choice between the already-present positions, never a blend of them.
//
// The route is admin-gated and cohort-write-gated like the accept/discard
// routes. A cell with no conflict earns a 400 (nothing to decide); a choice
// that is not one of the conflict's positions is a 400; a missing cell/draft is
// a 404. Recording a decision is a deliberate single action, never automatic,
// and a second decision on an already-resolved conflict is refused.

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
  const positionId = (body as { positionId?: unknown }).positionId;
  if (typeof positionId !== "string" || positionId === "") return badRequest();

  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;

    const readOnly = rejectIfCohortReadOnly(session);
    if (readOnly) return readOnly;

    try {
      const result = await recordOfficialCellDecision(
        db,
        session.respondentId,
        session.cohortId,
        cellId,
        positionId,
      );
      return NextResponse.json({ ok: true, version: result.version, cells: result.cells });
    } catch (err) {
      if (err instanceof NoOfficialConflictError) return badRequest();
      if (err instanceof UnknownConflictPositionError) return badRequest();
      if (err instanceof OfficialDraftNotFoundError) return notFound();
      throw err;
    }
  } finally {
    await db.end();
  }
}