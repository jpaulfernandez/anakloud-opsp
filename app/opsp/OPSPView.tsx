"use client";

import { useEffect, useRef, useState } from "react";
import {
  type OpspCell,
  type OpspCellId,
  type OpspMark,
} from "@/lib/opsp";
import type { DisplayNameResolver } from "@/lib/review";
import {
  OPSP_CELL_LABELS,
  OPSP_HORIZONS,
  formatOpspCellValue,
  formatOpspProvenance,
} from "@/lib/opsp-view";
import {
  OPSP_REVISIT_TAG,
  currentCellMark,
  opspCellNote,
  resolveOpspCellState,
  showsRevisitTag,
} from "@/lib/opsp-state";
import { OPSP_HOWTO } from "@/lib/opsp-howto";
import { PRINT_DRAFT_LABEL, formatExportTimestamp } from "@/lib/print";

// F07-T02 — the individual OPSP view and draft labelling (FR-23,
// ui_ux.md §4.14).
//
// F07-T03 — ink, pencil and empty cells (FR-24, §2, §7). The state and note
// decisions are resolved in lib/opsp-state.ts; this component only turns that
// deterministic state into classes and text.
//
// F07-T04 — the "How to read this" panel (FR-25, §4.14).
//
// F07-T05 — inline editing and versioning (FR-26, PR5, ui_ux.md §4.15). The
// respondent edits their own OPSP cells inline, one at a time, and manually
// toggles each cell's ink/pencil mark. Saving writes a new opsp_drafts version
// via PATCH /api/opsp/:id and never touches the answers (PR5); the component
// adopts the returned cells so the screen reflects the new version without a
// reload. A persistent edit bar carries the exact §4.15 note — it is always
// present, so the note is visible throughout editing, never once.
//
// F08-T02 — print and client save-as-PDF (FR-27, tech_infrastructure §7,
// ui_ux §4.16). Two export paths, both producing the same sheet:
//
//   * Primary — a "Save as PDF" trigger on the view calls window.print()
//     directly, with no server round trip. The sheet's name, timestamp and the
//     em-dash draft label render in a header that is hidden on screen and
//     revealed only under print media, so pressing the browser's
//     print/save-as-PDF from here carries them onto paper. The timestamp is
//     refreshed at the moment the trigger is pressed so the printed stamp
//     reflects when the respondent exported, not when the page loaded.
//
//   * Print route — /opsp/print serves this same component in printMode: it
//     renders the identical grid read-only (no edit bar, no per-cell controls,
//     no "How to read this" panel) with the header always visible. Because the
//     sheet markup is this one component in both modes, the server-rendered
//     PDF (F08-T03) and the browser print are equivalent by construction, not
//     by a second layout that could drift.
//
// Editing a cell turns its content block into a textarea pre-filled with the
// current rendered text (or empty for a blank cell) plus a two-way Ink/Pencil
// toggle. The respondent's rewrite is stored as plain text; clearing the field
// leaves the cell blank (never auto-filled back). On a save failure the cell
// stays in edit mode with the text intact rather than losing the respondent's
// typing.
export function OPSPView({
  cells: initialCells,
  rosterNames,
  draftId,
  name,
  printMode = false,
  printedAt,
}: {
  cells: Record<OpspCellId, OpspCell>;
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
  /** The draft id being viewed, targeted by the OPSP edit route (F07-T05). */
  draftId: string;
  /** The respondent's display name, printed on the sheet (FR-27). */
  name: string;
  /**
   * F08-T02 — print mode for the /opsp/print route: the sheet read-only, with
   * the export header always visible and none of the interactive chrome.
   */
  printMode?: boolean;
  /** The export timestamp for the sheet; supplied in print mode (server-side),
      and refreshed on the interactive view when save-as-PDF is triggered. */
  printedAt?: Date;
}) {
  const nameOf: DisplayNameResolver = (rid) => rosterNames[rid];

  // The draft cells as they currently read. Editing creates a new version and
  // the route returns the updated cells, which replace this state so the view
  // stays in sync without a reload.
  const [cells, setCells] = useState<Record<OpspCellId, OpspCell>>(initialCells);

  // F07-T05 edit state: which cell is being edited, the in-progress text and
  // the mark the toggle is set to. Nothing is written back to `cells` until
  // the respondent saves, so cancelling loses nothing and a failed save leaves
  // the draft box intact.
  const [editingId, setEditingId] = useState<OpspCellId | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMark, setDraftMark] = useState<OpspMark>("pencil");
  const [saving, setSaving] = useState(false);

  // The "How to read this" panel (F07-T04): which cell's explanation is active,
  // which entry to scroll to, and whether the mobile bottom sheet is expanded.
  const [activeId, setActiveId] = useState<OpspCellId | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const entryRefs = useRef<Partial<Record<OpspCellId, HTMLElement | null>>>({});
  const bodyRef = useRef<HTMLDivElement>(null);

  // The timestamp printed on the sheet (F08-T02). In print mode it is passed in
  // server-side at render; on the interactive view it starts now and is
  // refreshed when save-as-PDF is triggered, so the printed stamp reflects the
  // moment of export rather than the page load.
  const [printTimestamp, setPrintTimestamp] = useState(() =>
    formatExportTimestamp(new Date()),
  );

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

  /** Enter edit mode for a cell, pre-filling it from its current rendering. */
  function beginEdit(id: OpspCellId) {
    const cell = cells[id];
    setEditingId(id);
    setDraftText(cell ? formatOpspCellValue(cell.value, nameOf) : "");
    setDraftMark(cell ? currentCellMark(cell) : "pencil");
  }

  /** Save the in-progress edit as a new OPSP draft version. */
  async function saveEdit() {
    if (editingId === null || saving) return;
    const id = editingId;
    setSaving(true);
    try {
      const res = await fetch(`/api/opsp/${draftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id, content: draftText, mark: draftMark }),
      });
      if (!res.ok) {
        // Stay in edit mode so nothing the respondent typed is lost.
        return;
      }
      const data = (await res.json()) as {
        version: number;
        cells: Record<OpspCellId, OpspCell>;
      };
      setCells(data.cells);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  // F08-T02 — the primary export path. window.print() is a client call with no
  // server round trip; the timestamp is stamped at the moment of export so the
  // sheet reflects when the respondent asked for it.
  function saveAsPdf() {
    setPrintTimestamp(formatExportTimestamp(new Date()));
    window.print();
  }

  const editBarNote =
    "Editing this doesn't change your survey answers — those stay as you submitted them.";

  // The export header: name, timestamp and the FR-23 draft label. On the
  // interactive view it is hidden until print media, so it never competes with
  // the on-screen header; on the /opsp/print route it is the sheet's only
  // header and is always visible.
  const printHeader = (
    <header
      data-testid="opsp-print-header"
      className={printMode ? "mb-6" : "hidden print:block mb-6"}
    >
      <p
        data-testid="opsp-print-label"
        className="text-[13px] font-semibold tracking-wide text-neutral-900 uppercase"
      >
        {PRINT_DRAFT_LABEL}
      </p>
      <p data-testid="opsp-print-name" className="mt-1 text-base text-neutral-900">
        {name}
      </p>
      <p data-testid="opsp-print-timestamp" className="text-sm text-neutral-600">
        {printMode ? formatExportTimestamp(printedAt ?? new Date()) : printTimestamp}
      </p>
    </header>
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 text-base lg:pb-12">
      {printMode ? null : (
        <header data-testid="opsp-draft-label" className="max-w-2xl mb-8">
          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
            One-Page Strategic Plan
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            Your draft. Not the company&apos;s plan.
          </h1>
          <p className="mt-2 text-base leading-relaxed text-neutral-600">
            This is what your answers add up to. Everyone gets a different one.
            We&apos;ll build the real one together.
          </p>
          {/*
            F08-T02 — the save-as-PDF trigger, reachable from the OPSP view on
            mobile and desktop. It calls window.print() directly (no server
            round trip); the sheet it produces lives in the print-only header
            above and the print stylesheet below.
          */}
          <button
            type="button"
            data-testid="opsp-print-trigger"
            onClick={saveAsPdf}
            className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-cobalt-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
          >
            Save as PDF
          </button>
        </header>
      )}

      {printHeader}

      {/*
        F08-T01 — the print stylesheet targets this wrapper. On screen it is a
        two-column grid (plan | how-to panel). In print the panel is suppressed,
        so this wrapper is flattened to a single full-width block — the plan
        spans the sheet rather than sitting in a half-width column beside a
        column that no longer exists. The screen grid's lg: variant is a screen
        concern; print re-lays-out the plan, it does not scale the screen down.
      */}
      <div
        data-testid="opsp-document"
        className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] lg:items-start"
      >
        <div className="space-y-6">
          {printMode ? null : (
            <div
              data-testid="opsp-edit-bar"
              className="rounded-2xl border border-cobalt-200/60 bg-cobalt-50/50 p-4"
            >
              <p className="text-sm font-medium leading-relaxed text-cobalt-950">{editBarNote}</p>
            </div>
          )}

          <section
            data-testid="opsp-grid"
            aria-label="Your draft One-Page Strategic Plan"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-2"
          >
            {OPSP_HORIZONS.map((horizon) => (
              <div key={horizon.id} className="contents">
                <div
                  data-testid={`opsp-horizon-header-${horizon.id}`}
                  className="col-span-full mt-6 first:mt-0 mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200/80 pb-2 pt-1"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono font-bold tracking-wider text-cobalt-600">
                      {horizon.number}
                    </span>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                      {horizon.title}
                    </h3>
                    <span className="hidden sm:inline text-xs text-neutral-300">·</span>
                    <span className="hidden sm:inline text-xs text-neutral-500 font-medium">
                      {horizon.subtitle}
                    </span>
                  </div>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-neutral-600 uppercase">
                    {horizon.timeframe}
                  </span>
                </div>

                {horizon.cellIds.map((id) => {
                  const cell = cells[id];
                  if (!cell) return null;
                  const state = resolveOpspCellState(cell);
                  const editing = !printMode && editingId === id;
                  const ink = state.kind === "ink";
                  const content =
                    state.kind === "empty"
                      ? ""
                      : formatOpspCellValue(cell.value, nameOf);
                  const provenance =
                    state.kind === "empty" ? null : formatOpspProvenance(cell.sources);
                  const note = opspCellNote(state);
                  const revisit = showsRevisitTag(state);

                  const isHero =
                    id === "bhag" ||
                    id === "key_initiatives" ||
                    id === "quarterly_theme" ||
                    id === "accountability_face";

                  return (
                    <article
                      key={id}
                      data-testid={`opsp-cell-${id}`}
                      className={`rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card transition-all hover:border-neutral-300 flex flex-col justify-between ${
                        isHero
                          ? "sm:col-span-2 print:col-span-2"
                          : "sm:col-span-1 print:col-span-1"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 border-b border-neutral-100 pb-3">
                          <h2 className="text-xs font-bold tracking-wider text-neutral-600 uppercase">
                            {OPSP_CELL_LABELS[id]}
                          </h2>
                          {printMode ? null : (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                data-testid={`opsp-cell-edit-${id}`}
                                onClick={() => (editing ? undefined : beginEdit(id))}
                                aria-label={`Edit ${OPSP_CELL_LABELS[id]}`}
                                className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                data-testid={`opsp-howto-trigger-${id}`}
                                onClick={() => activateCell(id)}
                                aria-label={`How to read ${OPSP_CELL_LABELS[id]}`}
                                className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-cobalt-700 hover:bg-cobalt-50 hover:text-cobalt-800 transition-colors"
                              >
                                What&apos;s this?
                              </button>
                            </div>
                          )}
                        </div>

                        {editing ? (
                          <div className="mt-3">
                            <textarea
                              data-testid={`opsp-cell-input-${id}`}
                              value={draftText}
                              onChange={(e) => setDraftText(e.target.value)}
                              aria-label={OPSP_CELL_LABELS[id]}
                              rows={4}
                              className="w-full resize-y rounded-xl border border-neutral-300 bg-white p-3 text-sm leading-relaxed text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
                            />
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-neutral-500">Mark:</span>
                              <button
                                type="button"
                                data-testid={`opsp-mark-ink-${id}`}
                                onClick={() => setDraftMark("ink")}
                                aria-pressed={draftMark === "ink"}
                                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-all ${
                                  draftMark === "ink"
                                    ? "border-cobalt-600 bg-cobalt-600 text-white shadow-cobalt"
                                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                                }`}
                              >
                                Ink
                              </button>
                              <button
                                type="button"
                                data-testid={`opsp-mark-pencil-${id}`}
                                onClick={() => setDraftMark("pencil")}
                                aria-pressed={draftMark === "pencil"}
                                className={`rounded-lg border px-3 py-1 text-xs font-semibold transition-all ${
                                  draftMark === "pencil"
                                    ? "border-cobalt-600 bg-cobalt-600 text-white shadow-cobalt"
                                    : "border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                                }`}
                              >
                                Pencil
                              </button>
                              <span className="flex-1" />
                              <button
                                type="button"
                                data-testid={`opsp-cell-cancel-${id}`}
                                onClick={() => setEditingId(null)}
                                className="rounded-lg border border-neutral-200 px-3 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-colors"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                data-testid={`opsp-cell-save-${id}`}
                                onClick={saveEdit}
                                disabled={saving}
                                className="rounded-lg bg-cobalt-600 px-4 py-1 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
                              >
                                {saving ? "Saving…" : "Save"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            data-testid={`opsp-content-${id}`}
                            className={`mt-3 whitespace-pre-wrap text-sm leading-relaxed ${
                              ink
                                ? "font-medium text-neutral-900"
                                : "border-l-4 border-dashed border-neutral-400 pl-3 font-light text-neutral-700"
                            }`}
                          >
                            {content || ""}
                          </div>
                        )}
                      </div>

                      {!editing && (
                        <div className="mt-4 pt-2 border-t border-neutral-100/80">
                          {revisit ? (
                            <span
                              data-testid={`opsp-revisit-${id}`}
                              className="inline-block rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-amber-900 uppercase"
                            >
                              {OPSP_REVISIT_TAG}
                            </span>
                          ) : null}
                          {note !== null ? (
                            <p
                              data-testid={`opsp-note-${id}`}
                              className="mt-1.5 text-xs italic text-neutral-500"
                            >
                              {note}
                            </p>
                          ) : null}
                          {provenance !== null ? (
                            <p
                              data-testid={`opsp-provenance-${id}`}
                              className="mt-1.5 text-[11px] font-medium text-neutral-400"
                            >
                              {provenance}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ))}
          </section>
        </div>

        {printMode ? null : (
          <aside
            aria-label="How to read this plan"
            data-testid="opsp-howto-panel"
            className="fixed inset-x-0 bottom-0 z-20 flex max-h-[55vh] flex-col border-t border-neutral-200 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:sticky lg:top-6 lg:inset-auto lg:h-[calc(100vh-3rem)] lg:max-h-[calc(100vh-3rem)] lg:rounded-2xl lg:border lg:border-neutral-200/80 lg:shadow-card"
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4 lg:justify-start">
              <h2
                data-testid="opsp-howto-title"
                className="text-xs font-bold tracking-wider text-neutral-700 uppercase"
              >
                How to read this
              </h2>
              <button
                type="button"
                onClick={() => setMobileOpen((o) => !o)}
                aria-expanded={mobileOpen}
                data-testid="opsp-howto-toggle"
                className="shrink-0 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 lg:hidden"
              >
                {mobileOpen ? "Collapse" : "Expand"}
              </button>
            </div>
            <div
              ref={bodyRef}
              data-testid="opsp-howto-body"
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 lg:pb-4 ${
                mobileOpen ? "block" : "hidden lg:block"
              }`}
            >
              {OPSP_HORIZONS.map((horizon) => (
                <div key={horizon.id} className="mt-5 first:mt-2">
                  <div className="flex items-center justify-between border-b border-neutral-200/70 pb-1.5 mb-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-cobalt-600">
                        {horizon.number}
                      </span>
                      <h4 className="text-[11px] font-bold uppercase tracking-wider text-neutral-700">
                        {horizon.title}
                      </h4>
                    </div>
                    <span className="text-[10px] font-medium text-neutral-400">
                      {horizon.timeframe}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {horizon.cellIds.map((id) => {
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
                          className={`rounded-xl p-3.5 transition-all ${
                            active
                              ? "bg-cobalt-50/80 ring-1 ring-cobalt-200 border-l-4 border-cobalt-600 shadow-sm"
                              : "bg-neutral-50/70 border border-neutral-200/70 hover:bg-neutral-50"
                          }`}
                        >
                          <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-900">
                            {OPSP_CELL_LABELS[id]}
                          </h3>
                          <p className="mt-1.5 text-xs leading-relaxed text-neutral-700">
                            {entry.purpose}
                          </p>
                          <div className="mt-2 space-y-1 text-xs leading-relaxed text-neutral-600">
                            <p>
                              <span className="font-semibold text-neutral-900">Strong:</span> {entry.strong}
                            </p>
                            <p>
                              <span className="font-semibold text-neutral-900">Weak:</span> {entry.weak}
                            </p>
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}