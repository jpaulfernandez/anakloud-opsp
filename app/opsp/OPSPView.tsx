import { OPSP_CELL_IDS, type OpspCell, type OpspCellId } from "@/lib/opsp";
import type { DisplayNameResolver } from "@/lib/review";
import {
  OPSP_CELL_LABELS,
  formatOpspCellValue,
  formatOpspProvenance,
  isOpspCellEmpty,
} from "@/lib/opsp-view";

// F07-T02 — the individual OPSP view and draft labelling (FR-23,
// ui_ux.md §4.14). This is the plan a respondent gets back after submit: the
// sixteen cells derived deterministically from their own answers (F07-T01),
// served from the draft frozen at submit (F06-T03) and read back here (F07
// later lets them edit it into a different version — that is F07-T05, not
// this screen).
//
// The unmissable draft label is the first thing on the screen and is rendered
// unconditionally, by construction: it is a static header with no dismiss,
// collapse or skip control, placed above the cells, so a respondent can never
// trade the honesty label away to reach the grid faster. This is the FR-23
// requirement kept whole — the plan is explicitly "not the company's plan".
//
// Layout follows §4.14: a single-column stack of cards on a phone (360px is
// one column), fanning out into the classic OPSP columns once the viewport is
// wide. The same DOM renders both, so grid and stacked show identical content.
// Ink/pencil treatment and empty-cell notes are F07-T03; this screen renders
// content and the per-cell provenance line only.

export function OPSPView({
  cells,
  rosterNames,
}: {
  cells: Record<OpspCellId, OpspCell>;
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
}) {
  const nameOf: DisplayNameResolver = (rid) => rosterNames[rid];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-6 text-base">
      <header data-testid="opsp-draft-label" className="max-w-2xl">
        <h1 className="text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
          Your draft. Not the company&apos;s plan.
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          This is what your answers add up to. Everyone gets a different one.
          We&apos;ll build the real one together.
        </p>
      </header>

      <section
        data-testid="opsp-grid"
        aria-label="Your draft One-Page Strategic Plan"
        className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {OPSP_CELL_IDS.map((id) => {
          const cell = cells[id];
          if (!cell) return null;
          const empty = isOpspCellEmpty(cell);
          const content = empty
            ? ""
            : formatOpspCellValue(cell.value, nameOf);
          const provenance = empty ? null : formatOpspProvenance(cell.sources);
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
                className="mt-2 whitespace-pre-wrap font-sans text-[15px] leading-relaxed text-neutral-900"
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
    </main>
  );
}