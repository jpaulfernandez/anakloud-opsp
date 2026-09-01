"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface OpspHeaderProps {
  audienceMode: "facilitator" | "room";
  onToggleAudienceMode: () => void;
  activeCellId?: string;
  saveStatus?: string;
}

export function OpspHeader({
  audienceMode,
  onToggleAudienceMode,
  activeCellId,
  saveStatus,
}: OpspHeaderProps) {
  const [showWhatIsThis, setShowWhatIsThis] = useState(false);
  const pathname = usePathname();
  const isEdit = pathname.includes("/edit");

  const readHref = activeCellId ? `/opsp#${activeCellId}` : "/opsp";
  const editHref = activeCellId ? `/opsp/edit#${activeCellId}` : "/opsp/edit";

  return (
    <>
      <header className="sticky top-0 z-40 bg-stone-900 text-stone-100 px-4 py-2.5 shadow-sm border-b border-stone-800 flex flex-wrap items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/opsp" className="font-semibold tracking-tight text-white flex items-center gap-2">
            <span>Anakloud OPSP</span>
            <span className="text-xs font-normal text-stone-400 border border-stone-700 px-1.5 py-0.5 rounded">
              One-Page Strategic Plan
            </span>
          </Link>

          {/* "What is this?" Explainer Button */}
          <button
            type="button"
            onClick={() => setShowWhatIsThis(true)}
            className="inline-flex items-center gap-1 text-xs text-stone-300 hover:text-white bg-stone-800/80 hover:bg-stone-800 border border-stone-700 px-2 py-1 rounded transition-colors"
          >
            <span className="text-amber-400 font-bold text-xs">?</span>
            <span>What is this?</span>
          </button>

          {/* Persistent Audience Mode Chip */}
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                audienceMode === "facilitator"
                  ? "bg-amber-900/70 text-amber-200 border border-amber-700"
                  : "bg-emerald-950 text-emerald-300 border border-emerald-800"
              }`}
            >
              {audienceMode === "facilitator" ? "Audience: Facilitator" : "Audience: Room (Projected)"}
            </span>
            <button
              type="button"
              onClick={onToggleAudienceMode}
              className="text-xs text-stone-300 hover:text-white underline underline-offset-2 ml-1"
            >
              Switch to {audienceMode === "facilitator" ? "Room" : "Facilitator"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {saveStatus && (
            <span className="text-xs text-stone-400 hidden sm:inline">{saveStatus}</span>
          )}

          {/* View Switcher Toggle */}
          <div className="inline-flex rounded-md bg-stone-800 p-0.5 border border-stone-700">
            <Link
              href={readHref}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                !isEdit
                  ? "bg-stone-100 text-stone-900 font-medium shadow-sm"
                  : "text-stone-300 hover:text-white"
              }`}
            >
              Read View
            </Link>
            <Link
              href={editHref}
              className={`px-3 py-1 text-xs rounded transition-colors ${
                isEdit
                  ? "bg-stone-100 text-stone-900 font-medium shadow-sm"
                  : "text-stone-300 hover:text-white"
              }`}
            >
              Edit View
            </Link>
          </div>

          {/* Print link */}
          <Link
            href="/opsp/print"
            target="_blank"
            className="px-2.5 py-1 text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded transition-colors"
          >
            Print / PDF
          </Link>
        </div>
      </header>

      {/* "What is this?" Modal Dialog */}
      {showWhatIsThis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto border border-stone-300 text-stone-900 font-sans p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-stone-200 pb-3">
              <div>
                <h2 className="text-lg font-bold text-stone-900">
                  What is the One-Page Strategic Plan (OPSP)?
                </h2>
                <p className="text-xs text-stone-500">
                  Anakloud Strategy Alignment & Execution Roadmap
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatIsThis(false)}
                className="text-stone-400 hover:text-stone-700 p-1 text-base font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs leading-relaxed text-stone-700">
              {/* Section 1 */}
              <div className="bg-stone-50 p-3.5 rounded border border-stone-200 space-y-1.5">
                <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600"></span>
                  Why do we need this?
                </h3>
                <p>
                  As Anakloud transitions from a capstone project to a full-fledged healthcare venture, the founding team must be <strong>100% aligned</strong> on our purpose, targets, and immediate operational priorities.
                </p>
                <p>
                  Instead of maintaining 40-page decks that nobody reads, the <strong>One-Page Strategic Plan (Scaling Up / Rockefeller Habits framework)</strong> forces all strategy into 32 concise, actionable cells visible at a glance.
                </p>
              </div>

              {/* Section 2 */}
              <div className="space-y-2">
                <h3 className="font-bold text-stone-900 text-sm">
                  The 8 Strategic Horizons
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-2xs">
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">1. SWOT & Core Values:</span>
                    Internal strengths, market trends, vulnerabilities, and cultural principles.
                  </div>
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">2. Purpose & BHAG:</span>
                    Why we exist (Why) and our 10-year Big Hairy Audacious Goal.
                  </div>
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">3. 3-5 Year Targets:</span>
                    Future horizon, key target metrics, core customer sandbox, brand promises & economic engine.
                  </div>
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">4. 1-Year Goals & Actions:</span>
                    1-year initiatives, Critical Numbers, and 90-day Rocks to execute now.
                  </div>
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">5. Theme & Scoreboard:</span>
                    Quarterly rallying cry, measurable metric, scoreboard design, and celebration.
                  </div>
                  <div className="p-2 border border-stone-200 rounded bg-white">
                    <span className="font-semibold text-stone-900 block">6. Accountability:</span>
                    Individual weekly KPIs and quarterly priorities owned by each founder.
                  </div>
                </div>
              </div>

              {/* Section 3 */}
              <div className="space-y-2">
                <h3 className="font-bold text-stone-900 text-sm">
                  How this tool works
                </h3>
                <ul className="list-disc list-inside space-y-1 text-stone-600">
                  <li>
                    <strong>Read View:</strong> High-density single-screen dashboard designed for projecting during strategic alignment meetings.
                  </li>
                  <li>
                    <strong>Edit View & Source Panel:</strong> Allows you to edit any cell while viewing all 6 founders&apos; raw survey responses and confidence scores side-by-side.
                  </li>
                  <li>
                    <strong>Audience Mode:</strong> Keep it in <em>Room</em> mode during team meetings to protect private facilitation notes, or switch to <em>Facilitator</em> mode when facilitating.
                  </li>
                </ul>
              </div>
            </div>

            <div className="border-t border-stone-200 pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setShowWhatIsThis(false)}
                className="px-4 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded text-xs font-medium transition-colors"
              >
                Got it, let&apos;s build strategy
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
