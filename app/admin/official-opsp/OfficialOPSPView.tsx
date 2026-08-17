"use client";

import { useState } from "react";
import {
  OPSP_CELL_IDS,
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
import type { OfficialCell } from "@/lib/official-opsp";
import type { SourceCardCandidate } from "@/lib/official-source-cards";

// F15-T01 + F15-T02 — the official OPSP canvas (FR-36, FR-37, ui_ux.md §4.20).
// The same sixteen-cell grid as the individual OPSP, but it is the team's
// collaborative plan rather than one respondent's derivation: it opens blank
// (no cell is auto-filled from any snapshot) and the facilitator authors it
// during or after the alignment session. Editing one cell writes a new
// official draft version via PATCH /api/admin/official-opsp and never touches
// any answers row (PR5).
//
// F15-T02 adds source cards: under each cell the facilitator can pull any
// respondent's non-private answer in as an attributed card via `[+ Add
// someone's answer]` and a picker (GET/POST /api/admin/official-opsp/
// source-cards). Removing a card writes a new draft version and never alters
// the underlying answer. Like the individual canvas, every mutation adopts the
// returned cells so the grid reflects the new version without a reload.

/** The short "Q<number>" label used for attribution on a source card. */
function shortQuestion(id: string): string {
  return id.length > 0 && id[0] === "q" ? `Q${id.slice(1)}` : id.toUpperCase();
}

export function OfficialOPSPView({
  cells: initialCells,
}: {
  cells: Record<OpspCellId, OfficialCell>;
}) {
  const [cells, setCells] = useState<Record<OpspCellId, OfficialCell>>(initialCells);
  const [editingId, setEditingId] = useState<OpspCellId | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMark, setDraftMark] = useState<OpspMark>("pencil");
  const [saving, setSaving] = useState(false);

  // Source-card picker state (F15-T02). The candidate pool is fetched once on
  // the first open and reused across cells; the picker is per-cell.
  const [candidates, setCandidates] = useState<SourceCardCandidate[] | null>(null);
  const [pickerCellId, setPickerCellId] = useState<OpspCellId | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickingKey, setPickingKey] = useState<string | null>(null);

  // Classification (F15-T03): the first step of the two-step synthesis. When a
  // cell has 2+ source cards a Synthesise button appears; clicking it runs the
  // separate classification call and shows its verdict + reason. Drafting a
  // statement when compatible is F15-T04.
  const [classifyingId, setClassifyingId] = useState<OpspCellId | null>(null);
  const [classification, setClassification] = useState<
    Partial<Record<OpspCellId, { compatible: boolean; reason: string; level: string }>>
  >({});

  // F15-T04 — the guarded synthesis. After a compatible classification the cell
  // offers a "Draft statement" action (POST /api/admin/synthesise); whatever it
  // drafts is written onto the cell as a pending draft and stays visibly a
  // draft until the facilitator explicitly accepts it (or discards it). A
  // refusal — the conflict guard — is shown as a reason, never a statement.
  const [synthesisingId, setSynthesisingId] = useState<OpspCellId | null>(null);
  const [draftingId, setDraftingId] = useState<OpspCellId | null>(null);
  const [synthError, setSynthError] = useState<
    Partial<Record<OpspCellId, string>>
  >({});

  // F15-T05 — recording a decision on a conflict cell: the one affordance a
  // refused synthesis offers. It picks one of the two positions; the server
  // stores that position as the cell content with a note of who chose it.
  const [recordingId, setRecordingId] = useState<OpspCellId | null>(null);

  async function openPicker(id: OpspCellId) {
    setPickerCellId(id);
    if (candidates === null && !pickerLoading) {
      setPickerLoading(true);
      try {
        const res = await fetch("/api/admin/official-opsp/source-cards");
        if (!res.ok) return;
        const data = (await res.json()) as { candidates: SourceCardCandidate[] };
        setCandidates(data.candidates);
      } finally {
        setPickerLoading(false);
      }
    }
  }

  async function attach(candidate: SourceCardCandidate, id: OpspCellId) {
    const key = `${candidate.respondentId}:${candidate.questionId}`;
    if (pickingKey !== null) return;
    setPickingKey(key);
    try {
      const res = await fetch("/api/admin/official-opsp/source-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cellId: id,
          respondentId: candidate.respondentId,
          questionId: candidate.questionId,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        cells: Record<OpspCellId, OfficialCell>;
      };
      setCells(data.cells);
      setPickerCellId(null);
    } finally {
      setPickingKey(null);
    }
  }

  async function removeCard(id: OpspCellId, cardId: string) {
    if (saving) return;
    const res = await fetch("/api/admin/official-opsp/source-cards", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cellId: id, cardId }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      cells: Record<OpspCellId, OfficialCell>;
    };
    setCells(data.cells);
  }

  // F15-T03 — the first step of the two-step synthesis. Runs the separate
  // classification call for the cell and records its verdict + reason so the
  // facilitator can read why the sources were cleared or refused. Drafting the
  // statement when compatible is F15-T04. When the verdict is a genuine
  // conflict (F15-T05), the route persists both positions on the cell and we
  // adopt the returned cells so the conflict result state renders directly.
  async function classify(id: OpspCellId) {
    if (classifyingId !== null) return;
    setClassifyingId(id);
    try {
      const res = await fetch("/api/admin/synthesise/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        status?: string;
        classification?: { compatible: boolean; reason: string };
        level?: string;
        cells?: Record<OpspCellId, OfficialCell>;
      };
      if (data.status === "conflict" && data.cells !== undefined) {
        setCells(data.cells);
        return;
      }
      if (data.classification) {
        setClassification((prev) => ({
          ...prev,
          [id]: {
            compatible: data.classification!.compatible,
            reason: data.classification!.reason,
            level: data.level ?? "L0",
          },
        }));
      }
    } finally {
      setClassifyingId(null);
    }
  }

  // F15-T04 — STEP 2, the guarded synthesis. POST /api/admin/synthesise
  // re-runs the compatibility guard server-side (never trusting this button's
  // client state) and drafts a statement for the cell only when the sources
  // cleared. The drafted statement is written onto the cell as a pending draft:
  // it stays visibly a draft until the facilitator explicitly accepts it. If
  // the guard finds a genuine conflict (F15-T05), the route persists both
  // positions on the cell and we adopt those cells to render the decision
  // state; any other refusal leaves the cell untouched and shows the reason.
  async function synthesise(id: OpspCellId) {
    if (synthesisingId !== null || draftingId !== null) return;
    setSynthesisingId(id);
    setSynthError((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch("/api/admin/synthesise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        status: "drafted" | "refused" | "conflict";
        statement?: string;
        cells?: Record<OpspCellId, OfficialCell>;
        reason?: string;
      };
      if (data.status === "drafted" && data.cells !== undefined) {
        setCells(data.cells);
        setClassification((prev) => ({ ...prev, [id]: undefined }));
      } else if (data.status === "conflict" && data.cells !== undefined) {
        // A genuine conflict surfaced from the guard's re-check — enter the
        // decision state. Both positions are now on the cell.
        setCells(data.cells);
        setClassification((prev) => ({ ...prev, [id]: undefined }));
      } else if (data.status === "refused" && data.reason) {
        // A non-conflict refusal — a transient hold. Show the reason (both
        // positions when genuine conflict), never a draft.
        setSynthError((prev) => ({ ...prev, [id]: data.reason! }));
      }
    } finally {
      setSynthesisingId(null);
    }
  }

  // F15-T05 — [Record the decision] on a conflict cell: pick one of the two
  // positions. The server stores it as the cell content with a note of which
  // position was chosen and by whom; both positions stay visible afterwards.
  async function recordDecision(id: OpspCellId, positionId: string) {
    if (recordingId !== null) return;
    setRecordingId(id);
    try {
      const res = await fetch("/api/admin/synthesise/record-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id, positionId }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        cells: Record<OpspCellId, OfficialCell>;
      };
      setCells(data.cells);
    } finally {
      setRecordingId(null);
    }
  }

  // Explicit human acceptance of a pending draft (FR-40): the statement enters
  // the official OPSP only through this deliberate action, never automatically.
  async function acceptDraft(id: OpspCellId) {
    if (draftingId !== null) return;
    setDraftingId(id);
    try {
      const res = await fetch("/api/admin/synthesise/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        cells: Record<OpspCellId, OfficialCell>;
      };
      setCells(data.cells);
    } finally {
      setDraftingId(null);
    }
  }

  // Decline a pending draft without it entering the official plan.
  async function discardDraft(id: OpspCellId) {
    if (draftingId !== null) return;
    setDraftingId(id);
    try {
      const res = await fetch("/api/admin/synthesise/discard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cellId: id }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        cells: Record<OpspCellId, OfficialCell>;
      };
      setCells(data.cells);
    } finally {
      setDraftingId(null);
    }
  }

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
        cells: Record<OpspCellId, OfficialCell>;
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
          // F15-T05 — the conflict result state, and the chosen position once a
          // decision is recorded (which position and by whom is the note).
          const conflict = cell.conflict;
          const chosenPosition = conflict?.decision
            ? conflict.positions.find(
                (position) => position.id === conflict.decision!.positionId,
              )
            : undefined;
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

                  <button
                    type="button"
                    data-testid={`opsp-add-source-${id}`}
                    onClick={() => openPicker(id)}
                    className="mt-3 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                  >
                    + Add someone&apos;s answer
                  </button>

                  {pickerCellId === id ? (
                    <div
                      data-testid={`opsp-source-picker-${id}`}
                      className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 p-3"
                    >
                      <p className="text-xs font-medium text-neutral-600">
                        Pick an answer to attach
                      </p>
                      {pickerLoading ? (
                        <p className="mt-2 text-xs text-neutral-500">Loading…</p>
                      ) : (
                        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto">
                          {candidates && candidates.length > 0 ? (
                            candidates.map((candidate, i) => (
                              <button
                                key={`${candidate.respondentId}-${candidate.questionId}`}
                                type="button"
                                data-testid={`opsp-source-candidate-${i}`}
                                disabled={pickingKey !== null}
                                onClick={() => attach(candidate, id)}
                                className="block w-full rounded border border-neutral-200 bg-white px-2 py-1.5 text-left hover:border-neutral-300 hover:bg-neutral-100 disabled:opacity-50"
                              >
                                <span className="block text-[11px] font-semibold text-neutral-500">
                                  {candidate.respondentName} ·{" "}
                                  {shortQuestion(candidate.questionId)}
                                </span>
                                <span className="block whitespace-pre-wrap text-[13px] text-neutral-800">
                                  {candidate.text}
                                </span>
                              </button>
                            ))
                          ) : (
                            <p className="mt-1 text-xs text-neutral-500">
                              No answers to attach yet.
                            </p>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        data-testid={`opsp-source-cancel-${id}`}
                        onClick={() => setPickerCellId(null)}
                        className="mt-2 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                      >
                        Close
                      </button>
                    </div>
                  ) : null}

                  {cell.sourceCards.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      {cell.sourceCards.map((card, cardIndex) => (
                        <div
                          key={card.id}
                          data-testid={`opsp-source-card-${id}-${cardIndex}`}
                          className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p
                              data-testid={`opsp-source-attribution-${id}-${cardIndex}`}
                              className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase"
                            >
                              {card.respondentName} ·{" "}
                              {shortQuestion(card.questionId)}
                            </p>
                            <button
                              type="button"
                              data-testid={`opsp-source-remove-${id}-${cardIndex}`}
                              onClick={() => removeCard(id, card.id)}
                              aria-label={`Remove ${card.respondentName}'s answer from ${OPSP_CELL_LABELS[id]}`}
                              className="shrink-0 rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                            {card.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {/* F15-T04 — a pending AI draft is shown as a prominent draft
                      and stays out of the official plan until the facilitator
                      explicitly accepts it (FR-40). Declining drops it without
                      writing anything. */}
                  {cell.draft ? (
                    <div
                      data-testid={`opsp-draft-${id}`}
                      className="mt-3 rounded-md border border-dashed border-amber-400 bg-amber-50 px-3 py-2"
                    >
                      <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
                        Draft — not yet part of the plan
                      </p>
                      <p
                        data-testid={`opsp-draft-statement-${id}`}
                        className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-neutral-800"
                      >
                        {cell.draft.statement}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          data-testid={`opsp-draft-accept-${id}`}
                          onClick={() => acceptDraft(id)}
                          disabled={draftingId !== null}
                          className="rounded border border-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                        >
                          {draftingId === id ? "Accepting…" : "Accept into plan"}
                        </button>
                        <button
                          type="button"
                          data-testid={`opsp-draft-discard-${id}`}
                          onClick={() => discardDraft(id)}
                          disabled={draftingId !== null}
                          className="rounded border border-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 disabled:opacity-50"
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  ) : conflict ? (
                    /* F15-T05 — the conflict result state (FR-39, ui_ux.md
                       §4.20): the guard refused to synthesise, so the cell
                       shows both positions side by side with the prompt and a
                       single "[Record the decision]" action per position. There
                       is deliberately no merge control anywhere here — the
                       absence of the "merge anyway" button is the feature.
                       Recording a decision stores the chosen position as the
                       cell content and notes who chose; both positions stay
                       visible afterwards. */
                    <div
                      data-testid={`opsp-conflict-${id}`}
                      className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
                    >
                      <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
                        These don&apos;t reconcile
                      </p>
                      <p className="mt-1 text-[14px] font-medium leading-relaxed text-neutral-800">
                        These two don&apos;t reconcile. Someone has to choose.
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-600">
                        {conflict.reason}
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
                        {conflict.positions.map((position, positionIndex) => (
                          <div
                            key={position.id}
                            data-testid={`opsp-conflict-position-${id}-${positionIndex}`}
                            className="rounded-md border border-neutral-200 bg-white px-3 py-2"
                          >
                            <p
                              data-testid={`opsp-conflict-attribution-${id}-${positionIndex}`}
                              className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase"
                            >
                              {position.respondentName} ·{" "}
                              {shortQuestion(position.questionId)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                              {position.text}
                            </p>
                            {conflict.decision ? (
                              conflict.decision.positionId === position.id ? (
                                <p
                                  data-testid={`opsp-conflict-chosen-${id}`}
                                  className="mt-2 text-[11px] font-semibold text-neutral-600"
                                >
                                  Chosen
                                </p>
                              ) : null
                            ) : (
                              <button
                                type="button"
                                data-testid={`opsp-record-decision-${id}-${positionIndex}`}
                                onClick={() => recordDecision(id, position.id)}
                                disabled={recordingId !== null}
                                className="mt-2 rounded border border-neutral-900 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
                              >
                                {recordingId === id
                                  ? "Recording…"
                                  : "Record the decision"}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      {conflict.decision ? (
                        <p
                          data-testid={`opsp-conflict-note-${id}`}
                          className="mt-2 text-[11px] font-medium tracking-wide text-neutral-500 uppercase"
                        >
                          Decision recorded by {conflict.decision.recorderName} —{" "}
                          chose{" "}
                          {chosenPosition
                            ? `${chosenPosition.respondentName} (${shortQuestion(
                                chosenPosition.questionId,
                              )})`
                            : "a position"}
                        </p>
                      ) : null}
                    </div>
                  ) : cell.sourceCards.length >= 2 ? (
                    /* F15-T03 — Synthesise appears once 2+ sources are attached
                       (ui_ux.md §4.20). It runs the separate classification step
                       and shows the verdict + reason. Once classified compatible,
                       a guarded "Draft statement" (F15-T04) appears — the draft
                       is created only after the server re-checks compatibility
                       and lands as a pending draft, never straight into the plan. */
                    <div className="mt-3">
                      <button
                        type="button"
                        data-testid={`opsp-synthesise-${id}`}
                        onClick={() => classify(id)}
                        disabled={classifyingId !== null}
                        className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
                      >
                        {classifyingId === id ? "Classifying…" : "Synthesise"}
                      </button>
                      {classification[id] ? (
                        <div
                          data-testid={`opsp-classification-${id}`}
                          className="mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2"
                        >
                          <p className="text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">
                            {classification[id].compatible
                              ? "Compatible"
                              : "Not compatible"}
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                            {classification[id].reason}
                          </p>
                          {classification[id].compatible ? (
                            <button
                              type="button"
                              data-testid={`opsp-draft-statement-${id}`}
                              onClick={() => synthesise(id)}
                              disabled={synthesisingId !== null}
                              className="mt-2 rounded border border-neutral-300 px-2 py-0.5 text-[11px] font-medium text-neutral-700 hover:border-neutral-400 hover:bg-neutral-50 disabled:opacity-50"
                            >
                              {synthesisingId === id
                                ? "Drafting…"
                                : "Draft statement"}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {/* A refused synthesis — the conflict guard — surfaces as a
                          reason with both positions (never a statement). */}
                      {synthError[id] ? (
                        <div
                          data-testid={`opsp-synthesise-refused-${id}`}
                          className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2"
                        >
                          <p className="text-[11px] font-semibold tracking-wide text-amber-700 uppercase">
                            Not drafted
                          </p>
                          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700">
                            {synthError[id]}
                          </p>
                        </div>
                      ) : null}
                    </div>
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