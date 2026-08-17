"use client";

import { useEffect, useState } from "react";
import {
  type OpspCellId,
  type OpspMark,
} from "@/lib/opsp";
import {
  OPSP_CELL_LABELS,
  OPSP_HORIZONS,
  formatOpspCellValue,
} from "@/lib/opsp-view";
import { currentCellMark, resolveOpspCellState } from "@/lib/opsp-state";
import { QUESTION_MAP, type QuestionId } from "@/lib/questions";
import type {
  OfficialCell,
  OfficialSnapshot,
} from "@/lib/official-opsp";
import type { SourceCardCandidate } from "@/lib/official-source-cards";

// F15-T01 — the official OPSP canvas (FR-36, ui_ux.md §4.20).
//
// An empty 16-cell grid where every cell starts blank and ink/pencil is toggled
// manually by the facilitator. An inline edit bar carries the persistent note
// that edits here write the official plan, not the raw answers (PR5: answers
// stay immutable).
//
// F15-T02 — source-card attachment (FR-37). Each cell carries an "+ Add
// someone's answer" trigger that opens a picker of candidate answers for that
// cell's question mapping. Attached cards show the respondent's name and
// question number and can be removed with a single click.
//
// F15-T03 — source-card synthesis (FR-38, ui_ux.md §4.20). Once 2+ source cards
// are attached, a "Synthesise" action appears: it runs a classification check
// on the sources and reports whether they are compatible.
//
// F15-T04 — guarded statement drafting (FR-40). When sources clear the
// compatibility check, "Draft statement" asks the model for a single-sentence
// synthesis. The draft appears in a prominent draft box and enters the plan
// only when the facilitator explicitly clicks "[Accept into plan]".
//
// F15-T05 — conflict result state (FR-39). When the synthesis guard detects a
// genuine conflict, it refuses to draft a statement and instead persists both
// positions side by side with the verbatim prompt: "These two don't reconcile.
// Someone has to choose." and a "[Record the decision]" action on each position.
// There is no merge affordance anywhere (PR-GUARD: no "merge anyway").
//
// F15-T07 — version history and PDF export (FR-42). Named snapshots freeze a
// copy of the plan as it currently stands; snapshots can be viewed read-only.
// "Export PDF" downloads the rendered sheet through the shared print style.

function formatOfficialCellProvenance(provenance: OfficialCell["provenance"]): string | null {
  if (provenance.length === 0) return null;
  return provenance.join(" · ");
}

function shortQuestion(id: string): string {
  const def = QUESTION_MAP[id as QuestionId];
  return def ? `Q${id.replace("q", "")} · ${def.section}` : id;
}

export function OfficialOPSPView({
  cells: initialCells,
  initialSnapshots,
}: {
  cells: Record<OpspCellId, OfficialCell>;
  initialSnapshots?: OfficialSnapshot[];
}) {
  const [cells, setCells] =
    useState<Record<OpspCellId, OfficialCell>>(initialCells);
  const [editingId, setEditingId] = useState<OpspCellId | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftMark, setDraftMark] = useState<OpspMark>("pencil");
  const [saving, setSaving] = useState(false);

  // Source-card picker state: which cell is picking, the loaded candidates,
  // and which card is currently being attached.
  const [pickerCellId, setPickerCellId] = useState<OpspCellId | null>(null);
  const [candidates, setCandidates] = useState<SourceCardCandidate[] | null>(
    null,
  );
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickingKey, setPickingKey] = useState<string | null>(null);

  // Classification & synthesis state (F15-T03/T04).
  const [classifyingId, setClassifyingId] = useState<OpspCellId | null>(null);
  const [classification, setClassification] = useState<
    Record<
      OpspCellId,
      { compatible: boolean; reason: string; level: string } | undefined
    >
  >({} as Record<OpspCellId, { compatible: boolean; reason: string; level: string } | undefined>);
  const [synthesisingId, setSynthesisingId] = useState<OpspCellId | null>(null);
  const [synthError, setSynthError] = useState<Record<OpspCellId, string>>({} as Record<OpspCellId, string>);
  const [draftingId, setDraftingId] = useState<OpspCellId | null>(null);
  const [recordingId, setRecordingId] = useState<OpspCellId | null>(null);

  // F15-T07 — snapshot history and read-only view state.
  const [snapshots, setSnapshots] = useState<OfficialSnapshot[] | null>(
    initialSnapshots ?? null,
  );
  const [snapshotName, setSnapshotName] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [viewing, setViewing] = useState<OfficialSnapshot | null>(null);

  // Load snapshots if not provided initially.
  useEffect(() => {
    if (snapshots !== null) return;
    fetch("/api/admin/official-opsp/snapshots")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { snapshots?: OfficialSnapshot[] } | null) => {
        if (data?.snapshots) setSnapshots(data.snapshots);
      })
      .catch(() => {});
  }, [snapshots]);

  // Take a named snapshot of the current plan.
  async function takeSnapshot() {
    const label = snapshotName.trim();
    if (label === "" || snapshotSaving) return;
    setSnapshotSaving(true);
    try {
      const res = await fetch("/api/admin/official-opsp/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { snapshot: OfficialSnapshot };
      setSnapshotName("");
      setSnapshots((prev) => [data.snapshot, ...(prev ?? [])]);
    } finally {
      setSnapshotSaving(false);
    }
  }

  // Load one snapshot's cells for a read-only look back at a named version.
  async function viewSnapshot(version: number) {
    const res = await fetch(`/api/admin/official-opsp/snapshots/${version}`);
    if (!res.ok) return;
    const data = (await res.json()) as { snapshot: OfficialSnapshot };
    setViewing(data.snapshot);
  }

  // Leave a snapshot view and return to the working plan.
  function backToWorking() {
    setViewing(null);
  }

  // F15-T07 — PDF export (FR-42): the server renders the official print route
  // through the shared F08 print stylesheet at /api/admin/official-opsp/export
  // and answers application/pdf. Navigating there (this same-origin fetch
  // carries the session cookie) hands the facilitator the rendered plan.
  function exportPdf() {
    window.location.href = "/api/admin/official-opsp/export";
  }

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
        status?: string;
        level?: string;
        statement?: string;
        reason?: string;
        cells?: Record<OpspCellId, OfficialCell>;
      };
      if (data.status === "conflict" && data.cells !== undefined) {
        setCells(data.cells);
        return;
      }
      if (data.cells !== undefined) {
        setCells(data.cells);
      }
      if (data.status === "refused" && data.reason) {
        setSynthError((prev) => ({ ...prev, [id]: data.reason! }));
      }
    } finally {
      setSynthesisingId(null);
    }
  }

  // Record a human decision between conflicting positions (F15-T05).
  async function recordDecision(id: OpspCellId, positionId: string) {
    if (recordingId !== null) return;
    setRecordingId(id);
    try {
      const res = await fetch("/api/admin/synthesise/decision", {
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

  // F15-T07 — whether the canvas is showing a snapshot (read-only) vs the
  // working plan, and which cell set the grid renders.
  const readOnly = viewing !== null;
  const viewCells = viewing ? viewing.cells : cells;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 text-base">
      <header data-testid="official-opsp-header" className="max-w-2xl mb-6">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
          Official Plan Canvas
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          Official One-Page Strategic Plan
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          The company&apos;s plan, built together. Each cell starts blank — fill
          it in from the room. Editing here never changes anyone&apos;s survey
          answers.
        </p>
      </header>

      {/* F15-T07 — a snapshot view is read-only: the grid shows the named
          version's cells, authoring controls are hidden, and a single Back
          action returns to the working plan. */}
      {readOnly && viewing ? (
        <div
          data-testid="official-snapshot-viewing"
          className="mb-6 flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-card"
        >
          <p className="text-sm leading-relaxed text-amber-950">
            Viewing snapshot{" "}
            <span className="font-bold text-neutral-900">
              {viewing.label}
            </span>{" "}
            (v{viewing.version}) — a frozen copy of the plan as it was.
          </p>
          <button
            type="button"
            data-testid="official-snapshot-back"
            onClick={backToWorking}
            className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 transition-all"
          >
            Back to the working plan
          </button>
        </div>
      ) : (
        <>
          <p
            data-testid="official-opsp-editing-note"
            className="mb-6 max-w-2xl rounded-2xl border border-cobalt-200/60 bg-cobalt-50/50 p-4 text-sm font-medium leading-relaxed text-cobalt-950"
          >
            Edits here write the official plan, not the raw answers. Those stay
            as they were submitted.
          </p>

          {/* F15-T07 — version history and PDF export (FR-42). Name the current
              plan to record it as a snapshot; a snapshot never changes, however
              much you edit afterwards. The list loads from the server and each
              snapshot can be viewed read-only. Export PDF renders the official
              plan through the shared F08 print stylesheet. */}
          <section
            data-testid="official-version-history"
            className="mb-8 max-w-2xl rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card"
          >
            <h2 className="text-xs font-bold tracking-wider text-neutral-500 uppercase">
              Version history and export
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-neutral-600">
              Name the plan to freeze it as a snapshot. Snapshot copies never
              change, even as you keep editing.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2.5">
              <label
                data-testid="official-snapshot-label"
                className="text-xs font-semibold text-neutral-700"
                htmlFor="official-snapshot-name"
              >
                Snapshot name
              </label>
              <input
                id="official-snapshot-name"
                data-testid="official-snapshot-name"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                aria-labelledby="official-snapshot-label"
                className="min-h-[38px] w-48 rounded-xl border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-900 shadow-sm focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
              />
              <button
                type="button"
                data-testid="official-snapshot-take"
                onClick={takeSnapshot}
                disabled={snapshotSaving || snapshotName.trim() === ""}
                className="inline-flex min-h-[38px] items-center justify-center rounded-xl bg-cobalt-600 px-4 py-1.5 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
              >
                {snapshotSaving ? "Saving…" : "Take snapshot"}
              </button>
              <span className="flex-1" />
              <button
                type="button"
                data-testid="official-export-pdf"
                onClick={exportPdf}
                className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 transition-all"
              >
                Export PDF
              </button>
            </div>
            <div data-testid="official-snapshot-list" className="mt-4 space-y-1.5">
              {snapshots === null ? (
                <p className="text-xs text-neutral-500">Loading…</p>
              ) : snapshots.length === 0 ? (
                <p className="text-xs text-neutral-500 italic">No snapshots yet.</p>
              ) : (
                snapshots.map((snapshot) => (
                  <div
                    key={snapshot.id}
                    data-testid={`official-snapshot-${snapshot.version}`}
                    className="flex items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 px-3 py-2 text-xs"
                  >
                    <span className="font-medium text-neutral-800">
                      {snapshot.label}{" "}
                      <span className="text-[11px] text-neutral-400">
                        (v{snapshot.version})
                      </span>
                    </span>
                    <button
                      type="button"
                      data-testid={`official-snapshot-view-${snapshot.version}`}
                      onClick={() => viewSnapshot(snapshot.version)}
                      className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors shadow-subtle"
                    >
                      View
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        </>
      )}

      <section
        data-testid="official-opsp-grid"
        aria-label="Official One-Page Strategic Plan"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
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
              const cell = viewCells[id];
              if (!cell) return null;
              const state = resolveOpspCellState(cell);
              const editing = editingId === id;
              const ink = state.kind === "ink";
              const content =
                state.kind === "empty" ? "" : formatOpspCellValue(cell.value);
              const provenance =
                state.kind === "empty" || cell.provenance.length === 0
                  ? null
                  : formatOfficialCellProvenance(cell.provenance);
              // F15-T05 — the conflict result state, and the chosen position once a
              // decision is recorded (which position and by whom is the note).
              const conflict = cell.conflict;
              const chosenPosition = conflict?.decision
                ? conflict.positions.find(
                    (position) => position.id === conflict.decision!.positionId,
                  )
                : undefined;

              const isHero =
                id === "bhag" ||
                id === "key_initiatives" ||
                id === "quarterly_theme" ||
                id === "accountability_face";

              return (
                <article
                  key={id}
                  data-testid={`opsp-cell-${id}`}
                  className={`rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card flex flex-col justify-between ${
                    isHero ? "sm:col-span-2" : "sm:col-span-1"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 border-b border-neutral-100 pb-3">
                      <h2 className="text-xs font-bold tracking-wider text-neutral-500 uppercase">
                        {OPSP_CELL_LABELS[id]}
                      </h2>
                  {readOnly ? null : (
                    <button
                      type="button"
                      data-testid={`opsp-cell-edit-${id}`}
                      onClick={() => (editing ? undefined : beginEdit(id))}
                      aria-label={`Edit ${OPSP_CELL_LABELS[id]}`}
                      className="shrink-0 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                    >
                      Edit
                    </button>
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
                  <>
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
                    {provenance !== null ? (
                      <p
                        data-testid={`opsp-provenance-${id}`}
                        className="mt-3 text-[11px] font-medium text-neutral-400"
                      >
                        {provenance}
                      </p>
                    ) : null}

                    {/* F15-T07 — every authoring control (source cards, synthesis,
                        conflict decisions, drafts) belongs to the working plan. A
                        snapshot is a frozen copy of the plan's cells, so none of
                        it appears in a read-only snapshot view. */}
                    {!readOnly ? (
                    <>
                    <div className="mt-4 pt-3 border-t border-neutral-100">
                      <button
                        type="button"
                        data-testid={`opsp-add-source-${id}`}
                        onClick={() => openPicker(id)}
                        className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-cobalt-700 hover:bg-cobalt-50 hover:text-cobalt-800 transition-colors"
                      >
                        + Add someone&apos;s answer
                      </button>
                    </div>

                    {pickerCellId === id ? (
                      <div
                        data-testid={`opsp-source-picker-${id}`}
                        className="mt-3 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-4"
                      >
                        <p className="text-xs font-bold text-neutral-700 uppercase tracking-wider">
                          Pick an answer to attach
                        </p>
                        {pickerLoading ? (
                          <p className="mt-2 text-xs text-neutral-500">Loading…</p>
                        ) : (
                          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                            {candidates && candidates.length > 0 ? (
                              candidates.map((candidate, i) => (
                                <button
                                  key={`${candidate.respondentId}-${candidate.questionId}`}
                                  type="button"
                                  data-testid={`opsp-source-candidate-${i}`}
                                  disabled={pickingKey !== null}
                                  onClick={() => attach(candidate, id)}
                                  className="block w-full rounded-xl border border-neutral-200 bg-white p-3 text-left hover:border-cobalt-300 hover:bg-cobalt-50/20 disabled:opacity-50 transition-all shadow-subtle"
                                >
                                  <span className="block text-[11px] font-bold text-cobalt-700 uppercase tracking-wider">
                                    {candidate.respondentName} ·{" "}
                                    {shortQuestion(candidate.questionId)}
                                  </span>
                                  <span className="mt-1 block whitespace-pre-wrap text-xs text-neutral-800">
                                    {candidate.text}
                                  </span>
                                </button>
                              ))
                            ) : (
                              <p className="mt-1 text-xs text-neutral-500 italic">
                                No answers to attach yet.
                              </p>
                            )}
                          </div>
                        )}
                        <button
                          type="button"
                          data-testid={`opsp-source-cancel-${id}`}
                          onClick={() => setPickerCellId(null)}
                          className="mt-3 rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors shadow-subtle"
                        >
                          Close
                        </button>
                      </div>
                    ) : null}

                    {cell.sourceCards.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {cell.sourceCards.map((card, cardIndex) => (
                          <div
                            key={card.id}
                            data-testid={`opsp-source-card-${id}-${cardIndex}`}
                            className="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3"
                          >
                            <div className="flex items-center justify-between gap-2 border-b border-neutral-200/40 pb-1.5">
                              <p
                                data-testid={`opsp-source-attribution-${id}-${cardIndex}`}
                                className="text-[11px] font-bold tracking-wider text-neutral-600 uppercase"
                              >
                                {card.respondentName} ·{" "}
                                {shortQuestion(card.questionId)}
                              </p>
                              <button
                                type="button"
                                data-testid={`opsp-source-remove-${id}-${cardIndex}`}
                                onClick={() => removeCard(id, card.id)}
                                aria-label={`Remove ${card.respondentName}'s answer from ${OPSP_CELL_LABELS[id]}`}
                                className="shrink-0 rounded bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 hover:bg-rose-100 transition-colors"
                              >
                                Remove
                              </button>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
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
                        className="mt-3 rounded-2xl border-2 border-dashed border-amber-300 bg-amber-50/80 p-4"
                      >
                        <p className="text-[11px] font-bold tracking-wider text-amber-800 uppercase">
                          Draft — not yet part of the plan
                        </p>
                        <p
                          data-testid={`opsp-draft-statement-${id}`}
                          className="mt-2 whitespace-pre-wrap text-xs leading-relaxed font-medium text-neutral-900"
                        >
                          {cell.draft.statement}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid={`opsp-draft-accept-${id}`}
                            onClick={() => acceptDraft(id)}
                            disabled={draftingId !== null}
                            className="rounded-xl bg-cobalt-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
                          >
                            {draftingId === id ? "Accepting…" : "Accept into plan"}
                          </button>
                          <button
                            type="button"
                            data-testid={`opsp-draft-discard-${id}`}
                            onClick={() => discardDraft(id)}
                            disabled={draftingId !== null}
                            className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 disabled:opacity-50 transition-all"
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
                        className="mt-3 rounded-2xl border border-amber-300 bg-amber-50/90 p-4"
                      >
                        <p className="text-[11px] font-bold tracking-wider text-amber-900 uppercase">
                          These don&apos;t reconcile
                        </p>
                        <p className="mt-1 text-xs font-bold leading-relaxed text-amber-950">
                          These two don&apos;t reconcile. Someone has to choose.
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                          {conflict.reason}
                        </p>
                        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                          {conflict.positions.map((position, positionIndex) => (
                            <div
                              key={position.id}
                              data-testid={`opsp-conflict-position-${id}-${positionIndex}`}
                              className="rounded-xl border border-neutral-200 bg-white p-3 shadow-subtle flex flex-col justify-between"
                            >
                              <div>
                                <p
                                  data-testid={`opsp-conflict-attribution-${id}-${positionIndex}`}
                                  className="text-[10px] font-bold tracking-wider text-neutral-500 uppercase"
                                >
                                  {position.respondentName} ·{" "}
                                  {shortQuestion(position.questionId)}
                                </p>
                                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-neutral-800">
                                  {position.text}
                                </p>
                              </div>
                              {conflict.decision ? (
                                conflict.decision.positionId === position.id ? (
                                  <p
                                    data-testid={`opsp-conflict-chosen-${id}`}
                                    className="mt-2.5 text-[11px] font-bold text-emerald-700"
                                  >
                                    ✓ Chosen
                                  </p>
                                ) : null
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`opsp-record-decision-${id}-${positionIndex}`}
                                  onClick={() => recordDecision(id, position.id)}
                                  disabled={recordingId !== null}
                                  className="mt-2.5 rounded-lg bg-cobalt-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
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
                            className="mt-3 text-[11px] font-semibold tracking-wide text-neutral-600"
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
                          className="rounded-xl border border-neutral-300 bg-white px-3 py-1 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 disabled:opacity-50 transition-all"
                        >
                          {classifyingId === id ? "Classifying…" : "Synthesise"}
                        </button>
                        {classification[id] ? (
                          <div
                            data-testid={`opsp-classification-${id}`}
                            className="mt-2.5 rounded-xl border border-neutral-200 bg-neutral-50/80 p-3"
                          >
                            <p className="text-[10px] font-bold tracking-wider text-neutral-500 uppercase">
                              {classification[id].compatible
                                ? "Compatible"
                                : "Not compatible"}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                              {classification[id].reason}
                            </p>
                            {classification[id].compatible ? (
                              <button
                                type="button"
                                data-testid={`opsp-draft-statement-${id}`}
                                onClick={() => synthesise(id)}
                                disabled={synthesisingId !== null}
                                className="mt-2.5 rounded-lg bg-cobalt-600 px-3 py-1 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
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
                            className="mt-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3"
                          >
                            <p className="text-[10px] font-bold tracking-wider text-amber-700 uppercase">
                              Not drafted
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-neutral-700">
                              {synthError[id]}
                            </p>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    </>
                  ) : null}
                  </>
                )}
                </div>
              </article>
            );
          })}
        </div>
      ))}
    </section>
    </main>
  );
}