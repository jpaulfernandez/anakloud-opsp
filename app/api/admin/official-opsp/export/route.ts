import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import {
  OpspPdfUnavailableError,
  renderOfficialOpspPdf,
} from "@/lib/opsp-pdf";
import { SESSION_COOKIE } from "@/lib/session";

// F15-T07 — PDF export of the official OPSP (FR-42, tech_infrastructure §4).
// GET /api/admin/official-opsp/export renders the official print route
// /admin/official-opsp/print — the same read-only sheet and shared F08 print
// stylesheet the facilitator's browser print uses — to a PDF via headless
// Chromium, so the server export and the client print are equivalent by
// construction.
//
// The route is admin-gated and cohort-independent (a facilitator exports their
// own cohort's plan). It is a read, so a closed cohort still exports (ui_ux §6:
// OPSP and PDF remain accessible when read-only). The sheet it renders is built
// from `opsp_drafts` cells alone and never reads the answers table, so an
// `is_private` row can never reach the official export.
//
// When Chromium is unavailable the route answers a route-only 503, the same
// degradation contract as the individual PDF (F08-T03): the client-side print
// path stays usable, and nothing else in the admin area degrades.

/** The clear, route-only failure when Chromium is unavailable. */
function pdfUnavailable() {
  return NextResponse.json(
    { ok: false, reason: "print_unavailable" },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;

    const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
    if (!sessionToken) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const origin = new URL(request.url).origin;
    const pdf = await renderOfficialOpspPdf({ origin, sessionToken });
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="official-strategic-plan.pdf"',
      },
    });
  } catch (err) {
    if (err instanceof OpspPdfUnavailableError) return pdfUnavailable();
    throw err;
  } finally {
    await db.end();
  }
}