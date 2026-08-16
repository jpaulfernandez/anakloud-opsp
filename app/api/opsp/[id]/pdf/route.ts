import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireApiSession } from "@/lib/auth";
import { withRespondentContext } from "@/lib/access";
import { OpspPdfUnavailableError, renderOpspPdf } from "@/lib/opsp-pdf";
import { SESSION_COOKIE } from "@/lib/session";

// F08-T03 — server-side PDF rendering (tech_infrastructure.md §4, §7).
// GET /api/opsp/:id/pdf renders the authenticated print route to a PDF via
// headless Chromium. The route is gated exactly like every other OPSP route —
// a valid session, and a draft that is the caller's own individual draft — and
// the sheet that gets rendered is /opsp/print, the same read-only component
// the browser's own save-asPDF uses, so the two export paths agree by
// construction (the equivalence the acceptance checks for).
//
// The one hard edge the spec calls out: if Chromium is unavailable the system
// SHALL return a clear failure for THIS route only and the client-side print
// path SHALL remain usable. That is enforced here — renderOpspPdf rejects with
// OpspPdfUnavailableError and the route answers with a distinct 503 that does
// nothing to the /opsp view or any other route.

/** The one 404 for a draft that is not the caller's own individual draft. */
function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

/** The clear, route-only failure when Chromium is unavailable (spec §7). */
function pdfUnavailable() {
  return NextResponse.json(
    { ok: false, reason: "print_unavailable" },
    { status: 503 },
  );
}

export async function GET(
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

    // The :id must name the caller's own individual draft. A stranger's draft
    // (or a bogus id) returns 404 before any sheet is rendered — same guard
    // the edit route applies, so the PDF path can never expose someone else's
    // plan.
    const owned = await withRespondentContext(db, session.respondentId, (tx) =>
      tx.query(
        `select 1 from opsp_drafts
          where id = $1 and owner_type = 'individual'
            and owner_id = app_current_respondent()`,
        [id],
      ),
    );
    if (!owned.rowCount || owned.rowCount === 0) return notFound();

    const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!sessionToken) return notFound();

    const origin = new URL(request.url).origin;
    const pdf = await renderOpspPdf({ origin, sessionToken });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="your-strategic-plan.pdf"',
      },
    });
  } catch (err) {
    if (err instanceof OpspPdfUnavailableError) return pdfUnavailable();
    throw err;
  } finally {
    await db.end();
  }
}