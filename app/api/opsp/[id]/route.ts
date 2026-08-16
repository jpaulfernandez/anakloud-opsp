import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { withRespondentContext } from "@/lib/access";
import {
  createOpspDraftVersion,
  OpspDraftNotFoundError,
  parseOpspEdit,
} from "@/lib/opsp-edit";

// The OPSP draft API (F07-T05, FR-26, PR5, tech_infrastructure.md §4). The
// respondent edits their own individual OPSP draft inline; the :id targets the
// draft the /opsp page rendered. Both handlers run inside the respondent's RLS
// context and require the draft to be the caller's own individual draft — a
// cohort mate's draft (or an official P4 draft) is not reachable. PATCH writes
// a new opsp_drafts version and nothing else; the answers table is not touched,
// which is exactly what the "editing doesn't change your survey answers" copy
// promises.

/** The one, reason-free 400 for a malformed or wrong-shaped edit body. */
function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

/** The one 404 for a draft that is not the caller's own individual draft. */
function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

/**
 * Read the target draft. Only the caller's own individual draft is readable —
 * owner_id must be the current respondent — so a stranger's or an official
 * draft returns 404 before any cells are exposed.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;
    const { id } = await params;

    const { rows } = await withRespondentContext(db, session.respondentId, (tx) =>
      tx.query<{ version: number; cells: unknown }>(
        `select version, cells
           from opsp_drafts
          where id = $1 and owner_type = 'individual'
            and owner_id = app_current_respondent()`,
        [id],
      ),
    );
    const row = rows[0];
    if (!row) return notFound();
    return NextResponse.json({ ok: true, version: row.version, cells: row.cells });
  } finally {
    await db.end();
  }
}

/**
 * Edit the respondent's own latest individual draft: create one new version
 * from the edit. The route's only writes go through createOpspDraftVersion,
 * which inserts into opsp_drafts alone, so this path structurally cannot alter
 * an answers row (PR5).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireApiSession(db);
    if (!auth.ok) return auth.response;
    const session = auth.session;
    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest();
    }
    const edit = parseOpspEdit(body);
    if (!edit) return badRequest();

    // The draft being edited must be the caller's own individual draft. This
    // guard keeps the route honest about :id even though the new version is
    // always written to the caller's latest draft.
    const owned = await withRespondentContext(db, session.respondentId, (tx) =>
      tx.query(
        `select 1 from opsp_drafts
          where id = $1 and owner_type = 'individual'
            and owner_id = app_current_respondent()`,
        [id],
      ),
    );
    if (!owned.rowCount || owned.rowCount === 0) return notFound();

    let result;
    try {
      result = await createOpspDraftVersion(
        db,
        session.respondentId,
        session.cohortId,
        edit,
      );
    } catch (err) {
      if (err instanceof OpspDraftNotFoundError) return notFound();
      throw err;
    }
    return NextResponse.json({
      ok: true,
      version: result.version,
      cells: result.cells,
    });
  } finally {
    await db.end();
  }
}