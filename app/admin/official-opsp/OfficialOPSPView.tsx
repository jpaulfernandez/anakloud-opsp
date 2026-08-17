"use client";

import { useState } from "react";
import {
  OPSP_CELL_IDS,
  type OpspCell,
  type OpspCellId,
  type OpspMark,
} from "@/lib/opsp";
import {
  OPSP_CELL_LABELS,
  formatOpspCellValue,
  formatOpspProvenance,
} from "@/lib/opsp-view";
import {
  currentCellMark,
  resolveOpspCellState,
} from "@/lib/opsp-state";

// F15-T01 — the official OPSP canvas (FR-36, ui_ux.md §4.20). The same
// sixteen-cell grid as the individual OPSP, but it is the team's collaborative
// plan rather than one respondent's derivation: it opens blank (no cell is
// auto-filled from any snapshot) and the facilitator authors it during or
// after the alignment session. Editing one cell writes a new official draft
// version via PATCH /api/admin/official-opsp and never touches any answers row
// (PR5); like the individual canvas, saving adopts the returned cells so the
// grid reflects the new version without a reload.
export function OfficialOPSPView({
  cells: initialCells,
}: {
  cells: Record<OpspCellId, OpspCell>;
}) {
  const [cells, setCells] = useState<Record<OpspCellId, OpspCell>>(initialCells);
  const [editingId, setEditingId] = useState<OpspCellId | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMark, setDraftMark] = useState<OpspMark>("pencil");
  const [saving, setSaving] = useState(false);

  function beginEdit(id: OpspCellId) {
    const cell = cells[id];
    setEditingId(id);
    setDraftText(cell ? formatOpspCellValue(cell.value) : "");
    setDraftMark(cell ? currentCellMark(cell) : "pencil");
  }

  async function saveEdit() {
    if (editingId === null || saving) return;
    const id = editingId;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/official-opsp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id, content: draftText, mark: draftMark }),
      });
      if (!res.ok) {
        // Stay in edit mode so nothing the facilitator typed is lost.
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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 text-base">
      <header data-testid="official-opsp-header" className="max-w-2xl">
        <h1 className="text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
          Official One-Page Strategic Plan
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          The company&apos;s plan, built together. Each cell starts blank — fill
          it in from the room. Editing here never changes anyone&apos;s survey
          answers.
        </p>
      </header>

      <p
        data-testid="official-opsp-editing-note"
        className="mt-4 max-w-2xl rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm leading-relaxed text-neutral-700"
      >
        Edits here write the official plan, not the raw answers. Those stay as
        they were submitted.
      </p>

      <section
        data-testid="official-opsp-grid"
        aria-label="Official One-Page Strategic Plan"
        className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2"
      >
        {OPSP_CELL_IDS.map((id) => {
          const cell = cells[id];
          if (!cell) return null;
          const state = resolveOpspCellState(cell);
          const editing = editingId === id;
          const ink = state.kind === "ink";
          const content =
            state.kind === "empty" ? "" : formatOpspCellValue(cell.value);
          const provenance =
            state.kind === "empty" || cell.sources.length === 0
              ? null
              : formatOpspProvenance(cell.sources);
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
                  data-testid={`opsp-cell-edit-${id}`}
                  onClick={() => (editing ? undefined : beginEdit(id))}
                  aria-label={`Edit ${OPSP_CELL_LABELS[id]}`}
                  className="shrink-0 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                >
                  Edit
                </button>
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
    </main>
  );
}