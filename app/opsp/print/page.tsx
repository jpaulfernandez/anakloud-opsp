import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { getPlanPayload } from "@/lib/opsp-plan-db";
// Uses loadOpspPrintSheet data path semantics for private data exclusion
import { OpspReadGrid } from "../OpspReadGrid";

export const metadata: Metadata = {
  title: "Anakloud OPSP — Print",
  description: "One-page landscape print sheet for the 33-cell One-Page Strategic Plan",
};

export default async function OpspPrintPage() {
  let db = null;
  try {
    db = createDbClient();
    await db.connect();
  } catch {
    db = null;
  }

  let payload;
  try {
    // Room mode ensures facilitator notes are strictly excluded from the print sheet
    payload = await getPlanPayload(db, "room");
  } finally {
    if (db) {
      try {
        await db.end();
      } catch {}
    }
  }

  const printedAt = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="bg-white min-h-screen text-stone-900 font-sans p-4 print:p-0">
      <style>{`
        @page {
          size: landscape;
          margin: 8mm;
        }
        @media print {
          body {
            background-color: white !important;
            color: black !important;
            font-size: 8pt !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <header className="mb-3 border-b border-stone-400 pb-2 flex items-baseline justify-between">
        <div>
          <h1 className="text-base font-bold tracking-tight text-black uppercase">
            Anakloud — One-Page Strategic Plan
          </h1>
          <p className="text-xs text-stone-600">
            Scaling Up Framework · 33 Strategic Cells
          </p>
        </div>
        <div className="text-right text-xs text-stone-600">
          <span>Official Strategy Plan · {printedAt}</span>
        </div>
      </header>

      <main>
        <OpspReadGrid cells={payload.cells} isPrintMode={true} />
      </main>
    </div>
  );
}