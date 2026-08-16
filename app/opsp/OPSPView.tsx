"use client";

import { useEffect, useRef, useState } from "react";
import {
  OPSP_CELL_IDS,
  type OpspCell,
  type OpspCellId,
  type OpspMark,
} from "@/lib/opsp";
import type { DisplayNameResolver } from "@/lib/review";
import {
  OPSP_CELL_LABELS,
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
}: {
  cells: Record<OpspCellId, OpspCell>;
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
  /** The draft id being viewed, targeted by the OPSP edit route (F07-T05). */
  draftId: string;
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

  const editBarNote =
    "Editing this doesn't change your survey answers — those stay as you submitted them.";

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
        <div className="space-y-4">
          {/*
            F07-T05 — the persistent edit bar. It sits above the grid, is always
            present, and carries the §4.15 note verbatim. Because it does not
            depend on edit mode, the note is visible throughout editing rather
            than flashed once.
          */}
          <div
            data-testid="opsp-edit-bar"
            className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3"
          >
            <p className="text-sm leading-relaxed text-neutral-700">{editBarNote}</p>
          </div>

          <section
            data-testid="opsp-grid"
            aria-label="Your draft One-Page Strategic Plan"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2"
          >
            {OPSP_CELL_IDS.map((id) => {
              const cell = cells[id];
              if (!cell) return null;
              const state = resolveOpspCellState(cell);
              const editing = editingId === id;
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
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        data-testid={`opsp-cell-edit-${id}`}
                        onClick={() => (editing ? undefined : beginEdit(id))}
                        aria-label={`Edit ${OPSP_CELL_LABELS[id]}`}
                        className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        data-testid={`opsp-howto-trigger-${id}`}
                        onClick={() => activateCell(id)}
                        aria-label={`How to read ${OPSP_CELL_LABELS[id]}`}
                        className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                      >
                        What&apos;s this?
                      </button>
                    </div>
                  </div>

                  {editing ? (
                    <div className="mt-2">
                      <textarea
                        data-testid={`opsp-cell-input-${id}`}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        aria-label={OPSP_CELL_LABELS[id]}
                        rows={4}
                        className="w-full resize-y rounded border border-neutral-300 bg-white p-2 text-[15px] leading-relaxed text-neutral-900 focus:border-neutral-500 focus:outline-none"
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-neutral-500">Mark:</span>
                        <button
                          type="button"
                          data-testid={`opsp-mark-ink-${id}`}
                          onClick={() => setDraftMark("ink")}
                          aria-pressed={draftMark === "ink"}
                          className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                            draftMark === "ink"
                              ? "border-neutral-400 bg-neutral-100 text-neutral-900"
                              : "border-neutral-200 text-neutral-500"
                          }`}
                        >
                          Ink
                        </button>
                        <button
                          type="button"
                          data-testid={`opsp-mark-pencil-${id}`}
                          onClick={() => setDraftMark("pencil")}
                          aria-pressed={draftMark === "pencil"}
                          className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                            draftMark === "pencil"
                              ? "border-neutral-400 bg-neutral-100 text-neutral-900"
                              : "border-neutral-200 text-neutral-500"
                          }`}
                        >
                          Pencil
                        </button>
                        <span className="flex-1" />
                        <button
                          type="button"
                          data-testid={`opsp-cell-cancel-${id}`}
                          onClick={() => setEditingId(null)}
                          className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          data-testid={`opsp-cell-save-${id}`}
                          onClick={saveEdit}
                          disabled={saving}
                          className="rounded border border-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                        >
                          {saving ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                </article>
              );
            })}
          </section>
        </div>

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