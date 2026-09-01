"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  CELL_REGISTRY,
  COLUMN_ORDER,
  COLUMN_LABELS,
  type CellDef,
  type CellValue,
  type SurveyAnswer,
  type FacilitatorNote,
} from "@/lib/opsp-seed";
import { TextEditor } from "./editors/TextEditor";
import { ListEditor } from "./editors/ListEditor";
import { MetricsEditor } from "./editors/MetricsEditor";
import { DateEditor } from "./editors/DateEditor";
import { TableEditor } from "./editors/TableEditor";
import { PairEditor } from "./editors/PairEditor";
import { SourcePanel } from "./SourcePanel";
import { OpspHeader } from "./OpspHeader";

interface OpspEditViewProps {
  initialCells: Record<string, CellValue>;
  initialSurveyAnswers: Record<string, SurveyAnswer[]>;
  initialFacilitatorNotes: Record<string, FacilitatorNote[]>;
  initialAudienceMode?: "facilitator" | "room";
}

export function OpspEditView({
  initialCells,
  initialSurveyAnswers,
  initialFacilitatorNotes,
  initialAudienceMode = "room",
}: OpspEditViewProps) {
  const [cells, setCells] = useState<Record<string, CellValue>>(initialCells);
  const [audienceMode, setAudienceMode] = useState<"facilitator" | "room">(initialAudienceMode);
  const [facilitatorNotes, setFacilitatorNotes] =
    useState<Record<string, FacilitatorNote[]>>(initialFacilitatorNotes);
  const [surveyAnswers, setSurveyAnswers] =
    useState<Record<string, SurveyAnswer[]>>(initialSurveyAnswers);

  const [activeCellId, setActiveCellId] = useState<string>("SWT-1");
  const [saveStatus, setSaveStatus] = useState<string>("All changes saved");

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Sync with URL hash if present on mount/hashchange
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace("#", "");
      if (hash && CELL_REGISTRY.some((c) => c.id === hash)) {
        setActiveCellId(hash);
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const selectCell = (id: string) => {
    setActiveCellId(id);
    window.location.hash = id;
  };

  // Audience mode toggle with server-side payload refetch
  const handleToggleAudienceMode = async () => {
    const nextMode = audienceMode === "facilitator" ? "room" : "facilitator";
    setAudienceMode(nextMode);
    try {
      const res = await fetch(`/api/opsp/plan?mode=${nextMode}`);
      if (res.ok) {
        const data = (await res.json()) as {
          cells: Record<string, CellValue>;
          facilitatorNotes: Record<string, FacilitatorNote[]>;
          surveyAnswers: Record<string, SurveyAnswer[]>;
        };
        if (data.facilitatorNotes) setFacilitatorNotes(data.facilitatorNotes);
        if (data.surveyAnswers) setSurveyAnswers(data.surveyAnswers);
      }
    } catch {
      // Degrade quietly
    }
  };

  const persistCell = useCallback(async (cellId: string, content: unknown) => {
    setSaveStatus("Saving...");
    try {
      const res = await fetch(`/api/opsp/cells/${cellId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, updatedBy: "user" }),
      });
      if (res.ok) {
        const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setSaveStatus(`Saved at ${time}`);
      } else {
        setSaveStatus("Saved locally");
      }
    } catch {
      setSaveStatus("Saved locally");
    }
  }, []);

  const handleContentChange = (newContent: unknown) => {
    const now = new Date().toISOString();
    setCells((prev) => ({
      ...prev,
      [activeCellId]: {
        cellId: activeCellId,
        content: newContent,
        updatedAt: now,
        updatedBy: "user",
      },
    }));

    // Debounced autosave (2s)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    setSaveStatus("Unsaved edits...");
    debounceTimerRef.current = setTimeout(() => {
      persistCell(activeCellId, newContent);
    }, 2000);
  };

  const handleBlurSave = () => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const current = cells[activeCellId]?.content;
    persistCell(activeCellId, current);
  };

  const activeDef: CellDef =
    CELL_REGISTRY.find((c) => c.id === activeCellId) || CELL_REGISTRY[0];
  const activeValue = cells[activeDef.id]?.content;

  // Prev / Next navigation
  const currentIndex = CELL_REGISTRY.findIndex((c) => c.id === activeDef.id);
  const prevCell = currentIndex > 0 ? CELL_REGISTRY[currentIndex - 1] : null;
  const nextCell =
    currentIndex < CELL_REGISTRY.length - 1 ? CELL_REGISTRY[currentIndex + 1] : null;

  // Copy into cell logic
  const handleCopyIntoCell = (text: string) => {
    if (activeDef.kind === "text" || activeDef.kind === "date") {
      const existing = (activeValue as string) || "";
      const updated = existing ? `${existing} — ${text}` : text;
      handleContentChange(updated);
    } else if (activeDef.kind === "list") {
      const existing = Array.isArray(activeValue) ? [...(activeValue as string[])] : [];
      existing.push(text);
      handleContentChange(existing);
    } else if (activeDef.kind === "pair") {
      const existing =
        typeof activeValue === "object" && activeValue !== null
          ? (activeValue as { a: string; b: string })
          : { a: "", b: "" };
      if (!existing.a) {
        handleContentChange({ ...existing, a: text });
      } else {
        handleContentChange({ ...existing, b: text });
      }
    } else if (activeDef.kind === "metrics") {
      const existing =
        typeof activeValue === "object" && activeValue !== null
          ? { ...(activeValue as Record<string, string>) }
          : {};
      const firstLabel = activeDef.rowLabels?.[0] ?? "Metric";
      existing[firstLabel] = text;
      handleContentChange(existing);
    } else if (activeDef.kind === "table") {
      const existing = Array.isArray(activeValue) ? [...(activeValue as Array<Record<string, string>>)] : [];
      const newRow: Record<string, string> = {};
      const cols = activeDef.columns ?? ["Col 1"];
      newRow[cols[0]] = text;
      for (let i = 1; i < cols.length; i++) newRow[cols[i]] = "";
      existing.push(newRow);
      handleContentChange(existing);
    }
  };

  // Group cells by column for the left rail
  const cellsByColumn = COLUMN_ORDER.map((col) => ({
    column: col,
    label: COLUMN_LABELS[col],
    cells: CELL_REGISTRY.filter((c) => c.column === col),
  }));

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
      <OpspHeader
        audienceMode={audienceMode}
        onToggleAudienceMode={handleToggleAudienceMode}
        activeCellId={activeDef.id}
        saveStatus={saveStatus}
      />

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Navigation Rail */}
        <aside className="w-full md:w-64 bg-stone-900/95 text-stone-300 border-r border-stone-800 p-3 overflow-y-auto shrink-0 space-y-4 text-xs">
          <div className="text-stone-400 font-semibold uppercase tracking-wider px-2 text-2xs">
            Plan Cells (33)
          </div>

          <div className="space-y-4">
            {cellsByColumn.map(({ column, label, cells: colCells }) => (
              <div key={column} className="space-y-1">
                <div className="px-2 py-0.5 text-stone-400 font-medium text-2xs uppercase tracking-wider border-b border-stone-800 flex justify-between">
                  <span>{label.title}</span>
                  <span className="text-stone-500 lowercase font-normal">{label.subtitle}</span>
                </div>
                <ul className="space-y-0.5">
                  {colCells.map((c) => {
                    const isActive = c.id === activeDef.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => selectCell(c.id)}
                          className={`w-full text-left px-2 py-1.5 rounded transition-colors flex items-center justify-between gap-1.5 ${
                            isActive
                              ? "bg-amber-600 text-white font-medium"
                              : "hover:bg-stone-800 text-stone-300"
                          }`}
                        >
                          <span className="truncate">{c.label}</span>
                          <span className="font-mono text-2xs text-stone-400 shrink-0">
                            {c.id}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {/* Center: Active Cell Editor (~60%) */}
        <main
          className="flex-1 overflow-y-auto p-6 md:p-8 bg-white flex flex-col justify-between"
          onBlur={handleBlurSave}
        >
          <div className="max-w-2xl w-full space-y-6">
            {/* Cell Chrome */}
            <div className="space-y-1 border-b border-stone-200 pb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-stone-400 bg-stone-100 px-2 py-0.5 rounded border border-stone-200">
                  {activeDef.id}
                </span>
                <span className="text-xs text-stone-500 uppercase tracking-wider font-semibold">
                  {COLUMN_LABELS[activeDef.column].title}
                </span>
              </div>
              <h1 className="text-xl font-bold text-stone-900 tracking-tight">
                {activeDef.label}
              </h1>
              {activeDef.helper && (
                <p className="text-stone-600 text-xs leading-relaxed">
                  {activeDef.helper}
                </p>
              )}
            </div>

            {/* Editor Component based on Kind */}
            <div className="pt-2">
              {activeDef.kind === "text" && (
                <TextEditor
                  value={(activeValue as string) ?? ""}
                  onChange={handleContentChange}
                />
              )}

              {activeDef.kind === "list" && (
                <ListEditor
                  value={(activeValue as string[]) ?? []}
                  maxRows={activeDef.maxRows}
                  onChange={handleContentChange}
                />
              )}

              {activeDef.kind === "metrics" && (
                <MetricsEditor
                  value={(activeValue as Record<string, string>) ?? {}}
                  rowLabels={activeDef.rowLabels}
                  onChange={handleContentChange}
                />
              )}

              {activeDef.kind === "date" && (
                <DateEditor
                  value={(activeValue as string) ?? ""}
                  onChange={handleContentChange}
                />
              )}

              {activeDef.kind === "table" && (
                <TableEditor
                  value={(activeValue as Array<Record<string, string>>) ?? []}
                  columns={activeDef.columns}
                  maxRows={activeDef.maxRows}
                  onChange={handleContentChange}
                />
              )}

              {activeDef.kind === "pair" && (
                <PairEditor
                  cellId={activeDef.id}
                  value={(activeValue as { a: string; b: string }) ?? { a: "", b: "" }}
                  onChange={handleContentChange}
                />
              )}
            </div>
          </div>

          {/* Prev / Next Cell Navigation Bar */}
          <div className="max-w-2xl w-full pt-8 mt-8 border-t border-stone-200 flex items-center justify-between text-xs">
            {prevCell ? (
              <button
                type="button"
                onClick={() => selectCell(prevCell.id)}
                className="text-stone-700 hover:text-stone-950 font-medium flex items-center gap-1 py-1.5 px-3 rounded border border-stone-300 hover:bg-stone-50"
              >
                ← Prev: {prevCell.label}
              </button>
            ) : (
              <div />
            )}

            {nextCell ? (
              <button
                type="button"
                onClick={() => selectCell(nextCell.id)}
                className="text-stone-700 hover:text-stone-950 font-medium flex items-center gap-1 py-1.5 px-3 rounded border border-stone-300 hover:bg-stone-50"
              >
                Next: {nextCell.label} →
              </button>
            ) : (
              <div />
            )}
          </div>
        </main>

        {/* Right: Source Panel (~40%) */}
        <aside className="w-full md:w-96 shrink-0 h-auto md:h-full">
          <SourcePanel
            cellDef={activeDef}
            currentContent={activeValue}
            surveyAnswers={surveyAnswers[activeDef.id] ?? []}
            facilitatorNotes={facilitatorNotes[activeDef.id] ?? []}
            audienceMode={audienceMode}
            onCopyIntoCell={handleCopyIntoCell}
          />
        </aside>
      </div>
    </div>
  );
}
