import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { fetchExportCsv, includePrivateRequested } from "@/lib/export";

// F10-T05 — the CSV export of all answers (tech_infrastructure.md §4).
//
// GET /api/admin/export returns the cohort's answers as a spreadsheet CSV. The
// F09-T01 gate admits only a submitted facilitator; the cohort comes from the
// DB-resolved session, never the request. The default export excludes private
// rows at the query layer (lib/export.ts → lib/answers.ts). Private rows (the
// Q14(d) note) are released only when the caller explicitly requests them AND
// confirms — `includePrivate=true` with `confirmPrivate=false` silently falls
// through to a safe public export rather than leaking — and that re-confirmed
// path is recorded in `export_events` (migration 0008). The CSV itself is
// serialized by the pure RFC 4180 writer (lib/csv.ts) with a UTF-8 BOM, so
// multi-line and Taglish text opens intact in a spreadsheet.

export async function GET(request: Request) {
  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    const includePrivate = includePrivateRequested(
      new URL(request.url).searchParams,
    );

    const csv = await fetchExportCsv(db, respondentId, cohortId, includePrivate);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="answers.csv"',
      },
    });
  } finally {
    await db.end();
  }
}