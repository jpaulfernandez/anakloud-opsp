"use client";

import { useEffect, useRef, useState } from "react";
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
import { OPSP_HOWTO } from "@/lib/opsp-howto";

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
//
// F07-T04 — the "How to read this" panel (FR-25, §4.14) — is this screen's
// third job: a persistent guide rendered on the right at desktop and as a
// bottom sheet on mobile, whose content is the static, repository-authored text
// in lib/opsp-howto.ts (never generated or fetched at runtime). Activating a
// cell scrolls the panel to that cell's explanation. This is the only part of
// the screen that is interactive, so the component is a client component; the
// cells and roster it renders are still the pure, serializable data the page
// server loaded.
export function OPSPView({
  cells,
  rosterNames,
}: {
  cells: Record<OpspCellId, OpspCell>;
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
}) {
  const nameOf: DisplayNameResolver = (rid) => rosterNames[rid];

  // The "How to read this" panel (F07-T04): which cell's explanation is active,
  // which entry to scroll to, and whether the mobile bottom sheet is expanded.
  const [activeId, setActiveId] = useState<OpspCellId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const entryRefs = useRef<Partial<Record<OpspCellId, HTMLElement | null>>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  // When a cell is activated, scroll the panel body so that cell's explanation
  // is in view. We scroll only the panel's own scroll container, never the
  // page: centering the entry keeps it visible on both the desktop right-hand
  // column and the mobile bottom sheet without nudging the respondent's spot
  // in the grid. Smooth so the jump reads as a deliberate reveal.
  useEffect(() => {
    if (activeId === null) return;
    const entry = entryRefs.current[activeId];
    const body = bodyRef.current;
    if (!entry || !body) return;
    const bodyRect = body.getBoundingClientRect();
    const entryRect = entry.getBoundingClientRect();
    const targetTop =
      body.scrollTop +
      (entryRect.top - bodyRect.top) -
      body.clientHeight / 2 +
      entryRect.height / 2;
    body.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [activeId]);

  function activateCell(id: OpspCellId) {
    setActiveId(id);
    // On mobile the panel is a collapsed bottom sheet; activating a cell
    // expands it so the matching entry is actually visible on that layout.
    setMobileOpen(true);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 text-base lg:pb-10">
      <header data-testid="opsp-draft-label" className="max-w-2xl">
        <h1 className="text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
          Your draft. Not the company&apos;s plan.
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          This is what your answers add up to. Everyone gets a different one.
          We&apos;ll build the real one together.
        </p>
      </header>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] lg:items-start">
        <section
          data-testid="opsp-grid"
          aria-label="Your draft One-Page Strategic Plan"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2"
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
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
                    {OPSP_CELL_LABELS[id]}
                  </h2>
                  <button
                    type="button"
                    data-testid={`opsp-howto-trigger-${id}`}
                    onClick={() => activateCell(id)}
                    aria-label={`How to read ${OPSP_CELL_LABELS[id]}`}
                    className="shrink-0 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                  >
                    What&apos;s this?
                  </button>
                </div>
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

        {/*
          F07-T04 — the "How to read this" panel. Persistent: on desktop it
          sits in the right-hand grid column and sticks as the page scrolls; on
          mobile it is a bottom sheet, fixed to the viewport's lower edge with
          its own internal scroll. One DOM element reflows via the lg: breakpoint
          — mobile it is fixed with a bounded height, desktop sticky with a
          scrollable body — so the content is identical in both layouts. Its
          text is lib/opsp-howto.ts, authored in the repository and rendered
          verbatim: nothing here is generated or fetched at runtime.
        */}
        <aside
          aria-label="How to read this plan"
          data-testid="opsp-howto-panel"
          className="fixed inset-x-0 bottom-0 z-20 flex max-h-[55vh] flex-col border-t border-neutral-200 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.08)] lg:sticky lg:top-6 lg:inset-auto lg:h-[calc(100vh-3rem)] lg:max-h-[calc(100vh-3rem)] lg:rounded-lg lg:border lg:border-neutral-200 lg:shadow-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 lg:justify-start lg:px-5 lg:py-3">
            <h2
              data-testid="opsp-howto-title"
              className="text-sm font-semibold tracking-wide text-neutral-700 uppercase"
            >
              How to read this
            </h2>
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-expanded={mobileOpen}
              data-testid="opsp-howto-toggle"
              className="shrink-0 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 lg:hidden"
            >
              {mobileOpen ? "Collapse" : "Expand"}
            </button>
          </div>
          <div
            ref={bodyRef}
            data-testid="opsp-howto-body"
            className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 lg:px-5 lg:pb-3 ${
              mobileOpen ? "block" : "hidden lg:block"
            }`}
          >
            {OPSP_CELL_IDS.map((id) => {
              const entry = OPSP_HOWTO[id];
              const active = activeId === id;
              return (
                <section
                  key={id}
                  ref={(el) => {
                    entryRefs.current[id] = el;
                  }}
                  data-testid={`opsp-howto-${id}`}
                  data-active={active}
                  className={`mt-4 rounded-md p-3 ${
                    active
                      ? "bg-neutral-50 ring-1 ring-neutral-200"
                      : "bg-transparent"
                  }`}
                >
                  <h3 className="text-[13px] font-semibold text-neutral-900">
                    {OPSP_CELL_LABELS[id]}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-neutral-700">
                    {entry.purpose}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-neutral-700">
                    <span className="font-medium">Strong:</span> {entry.strong}
                  </p>
                  <p className="mt-1 text-[13px] leading-relaxed text-neutral-700">
                    <span className="font-medium">Weak:</span> {entry.weak}
                  </p>
                </section>
              );
            })}
          </div>
        </aside>
      </div>
    </main>
  );
}