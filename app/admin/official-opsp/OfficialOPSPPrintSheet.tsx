import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  OPSP_CELL_LABELS,
  formatOfficialCellProvenance,
  formatOpspCellValue,
} from "@/lib/opsp-view";
import { resolveOpspCellState } from "@/lib/opsp-state";
import { OFFICIAL_PRINT_LABEL, formatExportTimestamp } from "@/lib/print";
import type { OfficialCell } from "@/lib/official-opsp";

// F15-T07 — the read-only official OPSP print sheet (FR-42, tech_infrastructure
// §4, ui_ux §4.20). This is the markup the facilitator's browser print and the
// server PDF both render, so the two export paths are equivalent by
// construction exactly as F08 makes them for the individual plan.
//
// It renders the sixteen authored cells through the SHARED F08 print
// stylesheet: the section, cells and content carry the same test ids
// (`opsp-grid`, `opsp-cell-*`, `opsp-content-*`) the @media print rules in
// globals.css target, so a page break lands between sections, ink prints solid
// and pencil prints as a dashed left border, and the screen chrome is absent.
// Nothing here is interactive — no Edit, no source cards, no synthesis, no
// conflict controls — because the official plan, not the authoring surface,
// is what is exported.
//
// The sheet is built from the official `opsp_drafts` cells alone; it never
// reads the answers table, so an `is_private` row can no more reach the export
// than it could reach the source-card picker that filled these cells. Private
// exclusion is query-level for the picker and structural (no answers read at
// all) for the export.
export function OfficialOPSPPrintSheet({
  cells,
  cohortLabel,
  printedAt,
}: {
  cells: Record<OpspCellId, OfficialCell>;
  cohortLabel: string;
  printedAt: Date;
}) {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 text-base lg:pb-10">
      <header data-testid="opsp-print-header" className="mb-6">
        <p
          data-testid="opsp-print-label"
          className="text-[13px] font-semibold tracking-wide text-neutral-900 uppercase"
        >
          {OFFICIAL_PRINT_LABEL}
        </p>
        <p data-testid="opsp-print-name" className="mt-1 text-base text-neutral-900">
          {cohortLabel}
        </p>
        <p data-testid="opsp-print-timestamp" className="text-sm text-neutral-600">
          {formatExportTimestamp(printedAt)}
        </p>
      </header>

      <div
        data-testid="opsp-document"
        className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)]"
      >
        <section
          data-testid="opsp-grid"
          aria-label="Official One-Page Strategic Plan"
          className="grid grid-cols-1 gap-4 md:grid-cols-2"
        >
          {OPSP_CELL_IDS.map((id) => {
            const cell = cells[id];
            if (!cell) return null;
            const state = resolveOpspCellState(cell);
            const ink = state.kind === "ink";
            const content =
              state.kind === "empty" ? "" : formatOpspCellValue(cell.value);
            const provenance =
              state.kind === "empty" || cell.provenance.length === 0
                ? null
                : formatOfficialCellProvenance(cell.provenance);
            return (
              <article
                key={id}
                data-testid={`opsp-cell-${id}`}
                className="rounded-lg border border-neutral-200 bg-white p-4"
              >
                <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
                  {OPSP_CELL_LABELS[id]}
                </h2>
                <div
                  data-testid={`opsp-content-${id}`}
                  className={`mt-2 whitespace-pre-wrap text-[15px] leading-relaxed ${
                    ink
                      ? "font-normal text-neutral-900"
                      : "border-l-4 border-dashed border-neutral-400 pl-3 font-light text-neutral-700"
                  }`}
                >
                  {content || ""}
                </div>
                {provenance !== null ? (
                  <p
                    data-testid={`opsp-provenance-${id}`}
                    className="mt-3 text-xs text-neutral-400"
                  >
                    {provenance}
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}