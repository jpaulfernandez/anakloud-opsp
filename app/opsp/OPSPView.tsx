import { OPSP_CELL_IDS, type OpspCell, type OpspCellId } from "@/lib/opsp";
import type { DisplayNameResolver } from "@/lib/review";
import {
  OPSP_CELL_LABELS,
  formatOpspCellValue,
  formatOpspProvenance,
} from "@/lib/opsp-view";
import {
  OPSP_REVISIT_TAG,
  opspCellNote,
  resolveOpspCellState,
  showsRevisitTag,
} from "@/lib/opsp-state";

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
//
// The ink/pencil and empty-cell treatment (F07-T03, FR-24, §2, §7) is this
// screen's second job: content derived from confident, complete answers
// renders as ink (solid text at full contrast); content whose source was blank
// or low-confidence renders as pencil — lighter weight, a dashed left border
// and a "revisit" tag, never colour — so the distinction survives printing in
// greyscale. Pencil cells that are pencil because the respondent was unsure
// carry the low-confidence note; empty cells carry the empty note and are never
// auto-filled. The state and note decisions are resolved in lib/opsp-state.ts;
// this component only turns that deterministic state into classes and text.
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
          const state = resolveOpspCellState(cell);
          const ink = state.kind === "ink";
          const content =
            state.kind === "empty"
              ? ""
              : formatOpspCellValue(cell.value, nameOf);
          const provenance =
            state.kind === "empty" ? null : formatOpspProvenance(cell.sources);
          const note = opspCellNote(state);
          const revisit = showsRevisitTag(state);
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
              {revisit ? (
                <span
                  data-testid={`opsp-revisit-${id}`}
                  className="mt-3 inline-block rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-medium tracking-wide text-neutral-500 uppercase"
                >
                  {OPSP_REVISIT_TAG}
                </span>
              ) : null}
              {note !== null ? (
                <p
                  data-testid={`opsp-note-${id}`}
                  className="mt-3 text-xs italic text-neutral-500"
                >
                  {note}
                </p>
              ) : null}
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