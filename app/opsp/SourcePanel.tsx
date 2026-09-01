"use client";

import { useState } from "react";
import type { CellDef, SurveyAnswer, FacilitatorNote } from "@/lib/opsp-seed";
import type { CellIdeationResult } from "@/lib/opsp-ideate-prompt";

interface SourcePanelProps {
  cellDef: CellDef;
  currentContent: unknown;
  surveyAnswers: SurveyAnswer[];
  facilitatorNotes: FacilitatorNote[];
  audienceMode: "facilitator" | "room";
  onCopyIntoCell: (text: string) => void;
}

export function SourcePanel({
  cellDef,
  currentContent,
  surveyAnswers = [],
  facilitatorNotes = [],
  audienceMode,
  onCopyIntoCell,
}: SourcePanelProps) {
  const [ideation, setIdeation] = useState<CellIdeationResult | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleFetchIdeation = async () => {
    setLoadingAi(true);
    try {
      const res = await fetch("/api/opsp/ideate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cellId: cellDef.id,
          currentContent,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; ideation: CellIdeationResult };
        if (data.ok && data.ideation) {
          setIdeation(data.ideation);
        }
      }
    } catch {
      // Degrade quietly
    } finally {
      setLoadingAi(false);
    }
  };

  const handleCopy = (text: string, index?: number) => {
    onCopyIntoCell(text);
    if (index !== undefined) {
      setCopiedIdx(index);
      setTimeout(() => setCopiedIdx(null), 1500);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-stone-50 border-l border-stone-200 p-4 space-y-6 text-xs">
      {/* 1. Source Question Header */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">
          Source Context
        </h3>
        {cellDef.sourceQuestion ? (
          <p className="text-stone-800 font-medium text-xs bg-stone-200/70 px-2.5 py-1.5 rounded border border-stone-300">
            {cellDef.sourceQuestion}
          </p>
        ) : (
          <p className="text-stone-400 italic">Not covered by the survey.</p>
        )}
      </div>

      {/* 2. Facilitator Notes (Server-Gated & Only shown in Facilitator Mode) */}
      {audienceMode === "facilitator" && facilitatorNotes.length > 0 && (
        <div className="bg-amber-50/80 border border-amber-300 rounded p-3 space-y-1.5 text-amber-900">
          <div className="flex items-center gap-1.5 font-semibold text-amber-800">
            <span className="w-2 h-2 rounded-full bg-amber-500 inline-block"></span>
            Facilitator Strategic Note
          </div>
          {facilitatorNotes.map((note, idx) => (
            <p key={idx} className="leading-relaxed text-amber-950/90 text-xs">
              {note.body}
            </p>
          ))}
        </div>
      )}

      {/* 3. Strategic Ideation Assistant (Annotation Panel) */}
      <div className="border border-indigo-200 bg-indigo-50/50 rounded-lg p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 font-semibold text-indigo-900">
            <span className="text-indigo-600 font-mono">✦</span>
            Strategic Annotations & Synthesis
          </div>
          <button
            type="button"
            onClick={handleFetchIdeation}
            disabled={loadingAi}
            className="px-2.5 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded transition-colors"
          >
            {loadingAi ? "Synthesizing..." : ideation ? "Re-synthesize" : "Generate Synthesis"}
          </button>
        </div>

        <p className="text-indigo-950/70 text-xs leading-relaxed">
          Analyzes the team&apos;s stacked answers to highlight patterns, tensions, and synthesis drafts.
          These thoughts remain annotations and do not automatically overwrite your cell.
        </p>

        {ideation && (
          <div className="space-y-3 pt-2 border-t border-indigo-200/60">
            <div>
              <span className="font-semibold text-indigo-950">Synthesis Summary:</span>
              <p className="text-indigo-900 mt-0.5 leading-relaxed">{ideation.summary}</p>
            </div>

            {ideation.themes && ideation.themes.length > 0 && (
              <div>
                <span className="font-semibold text-indigo-950">Common Themes:</span>
                <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-indigo-900">
                  {ideation.themes.map((t, idx) => (
                    <li key={idx}>{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {ideation.tensions && ideation.tensions.length > 0 && (
              <div>
                <span className="font-semibold text-indigo-950">Strategic Tensions:</span>
                <ul className="list-disc list-inside mt-0.5 space-y-0.5 text-amber-900">
                  {ideation.tensions.map((t, idx) => (
                    <li key={idx}>{t}</li>
                  ))}
                </ul>
              </div>
            )}

            {ideation.suggestions && ideation.suggestions.length > 0 && (
              <div className="space-y-1.5">
                <span className="font-semibold text-indigo-950">Suggested Drafts:</span>
                {ideation.suggestions.map((s, idx) => (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-2 p-2 bg-white rounded border border-indigo-200/80 text-stone-800"
                  >
                    <p className="text-xs leading-relaxed flex-1">{s}</p>
                    <button
                      type="button"
                      onClick={() => handleCopy(s)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-0.5 rounded border border-indigo-200 hover:bg-indigo-50 shrink-0"
                    >
                      Copy into cell
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Stacked Survey Answers from Teammates */}
      <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
          Founder Answers ({surveyAnswers.length})
        </h3>

        {surveyAnswers.length === 0 ? (
          <p className="text-stone-400 italic">No survey answers available for this cell.</p>
        ) : (
          <div className="space-y-2.5">
            {surveyAnswers.map((item, idx) => (
              <div
                key={idx}
                className="bg-white border border-stone-200 rounded p-3 space-y-2 shadow-2xs hover:border-stone-300 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-stone-900">{item.person}</span>
                  {item.confidence !== undefined && (
                    <span className="text-stone-500 font-mono font-medium">
                      {item.confidence}/5
                    </span>
                  )}
                </div>

                <p className="text-stone-800 text-xs leading-relaxed whitespace-pre-wrap">
                  {item.answer}
                </p>

                {item.meta && Object.keys(item.meta).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {Object.entries(item.meta).map(([k, v]) => (
                      <span
                        key={k}
                        className="inline-flex items-center gap-1 bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded text-2xs font-mono"
                      >
                        <span className="text-stone-400">{k}:</span> {v}
                      </span>
                    ))}
                  </div>
                )}

                <div className="pt-1 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleCopy(item.answer, idx)}
                    className="text-xs text-stone-600 hover:text-stone-900 font-medium px-2 py-0.5 rounded border border-stone-200 hover:bg-stone-50 transition-colors"
                  >
                    {copiedIdx === idx ? "Copied!" : "Copy into cell"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
