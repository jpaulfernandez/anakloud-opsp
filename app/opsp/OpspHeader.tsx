"use client";

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
  const pathname = usePathname();
  const isEdit = pathname.includes("/edit");

  const readHref = activeCellId ? `/opsp#${activeCellId}` : "/opsp";
  const editHref = activeCellId ? `/opsp/edit#${activeCellId}` : "/opsp/edit";

  return (
    <header className="sticky top-0 z-40 bg-stone-900 text-stone-100 px-4 py-2.5 shadow-sm border-b border-stone-800 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-4">
        <Link href="/opsp" className="font-semibold tracking-tight text-white flex items-center gap-2">
          <span>Anakloud OPSP</span>
          <span className="text-xs font-normal text-stone-400 border border-stone-700 px-1.5 py-0.5 rounded">
            One-Page Strategic Plan
          </span>
        </Link>

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
  );
}
