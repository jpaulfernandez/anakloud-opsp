"use client";

import Link from "next/link";
import {
  CELL_REGISTRY_MAP,
  type CellDef,
  type CellValue,
} from "@/lib/opsp-seed";

interface OpspReadGridProps {
  cells: Record<string, CellValue>;
  isPrintMode?: boolean;
}

export function OpspReadGrid({ cells, isPrintMode = false }: OpspReadGridProps) {
  // Helper to render cell value content based on kind
  const renderCellContent = (def: CellDef) => {
    const value = cells[def.id]?.content;

    if (value === undefined || value === null || value === "") {
      return <span className="text-stone-300 select-none font-serif">—</span>;
    }

    if (def.kind === "text" || def.kind === "date") {
      const str = String(value).trim();
      return str ? (
        <p className="whitespace-pre-wrap leading-tight text-stone-800">{str}</p>
      ) : (
        <span className="text-stone-300 select-none font-serif">—</span>
      );
    }

    if (def.kind === "list") {
      const list = Array.isArray(value) ? value.filter(Boolean) : [];
      if (list.length === 0) {
        return <span className="text-stone-300 select-none font-serif">—</span>;
      }
      return (
        <ul className="space-y-0.5 list-disc list-inside leading-tight text-stone-800">
          {list.map((item, idx) => (
            <li key={idx} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      );
    }

    if (def.kind === "metrics") {
      let entries: Array<[string, string]> = [];
      if (Array.isArray(value)) {
        entries = value.map((r) => [String(r.label || ""), String(r.value || "")]);
      } else if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, string>;
        const keys = Object.keys(obj).length > 0 ? Object.keys(obj) : (def.rowLabels ?? []);
        entries = keys.map((k) => [k, obj[k] ?? ""]);
      }
      const hasAny = entries.some(([k, v]) => Boolean(k.trim() || v.trim()));
      if (!hasAny) {
        return <span className="text-stone-300 select-none font-serif">—</span>;
      }
      return (
        <div className="space-y-0.5 text-2xs leading-tight">
          {entries.map(([lbl, val], idx) => (
            <div key={idx} className="flex items-baseline justify-between gap-1 border-b border-stone-100 last:border-0 pb-0.5">
              <span className="text-stone-500 font-medium truncate">{lbl || "Metric"}:</span>
              <span className="font-semibold text-stone-900 truncate">{val || "—"}</span>
            </div>
          ))}
        </div>
      );
    }

    if (def.kind === "pair") {
      const pair = typeof value === "object" ? (value as { a?: string; b?: string }) : {};
      if (!pair.a && !pair.b) {
        return <span className="text-stone-300 select-none font-serif">—</span>;
      }
      return (
        <div className="space-y-0.5 text-2xs leading-tight">
          <div>
            <span className="text-stone-400 font-medium">A: </span>
            <span className="text-stone-900 font-medium">{pair.a || "—"}</span>
          </div>
          <div>
            <span className="text-stone-400 font-medium">B: </span>
            <span className="text-stone-900 font-medium">{pair.b || "—"}</span>
          </div>
        </div>
      );
    }

    if (def.kind === "table") {
      const rows = Array.isArray(value) ? value : [];
      if (rows.length === 0) {
        return <span className="text-stone-300 select-none font-serif">—</span>;
      }
      const cols = def.columns ?? Object.keys(rows[0] ?? {});
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-2xs border-collapse">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500 font-medium">
                {cols.map((c) => (
                  <th key={c} className="p-0.5 font-medium truncate">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rIdx) => (
                <tr key={rIdx} className="border-b border-stone-100 last:border-0">
                  {cols.map((c) => (
                    <td key={c} className="p-0.5 text-stone-800 truncate max-w-[120px]">
                      {r[c] || "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    return <span className="text-stone-300 select-none font-serif">—</span>;
  };

  const renderCellBlock = (cellId: string) => {
    const def = CELL_REGISTRY_MAP[cellId];
    if (!def) return null;

    const cellWrapper = (
      <div
        id={def.id}
        className="p-1.5 bg-white flex flex-col justify-start gap-0.5 border border-stone-200 rounded-2xs hover:border-stone-400 transition-colors group relative"
      >
        <div className="flex items-baseline justify-between gap-1 border-b border-stone-100 pb-0.5">
          <span className="text-2xs font-bold uppercase tracking-tight text-stone-700 truncate">
            {def.label}
          </span>
          <span className="font-mono text-3xs text-stone-400 shrink-0">{def.id}</span>
        </div>
        <div className="text-2xs text-stone-800 pt-0.5 leading-tight overflow-hidden">
          {renderCellContent(def)}
        </div>
      </div>
    );

    if (isPrintMode) {
      return cellWrapper;
    }

    return (
      <Link
        key={def.id}
        href={`/opsp/edit#${def.id}`}
        className="block focus:outline-none"
        title={`Edit ${def.label} (${def.id})`}
      >
        {cellWrapper}
      </Link>
    );
  };

  return (
    <div className="w-full max-w-[1536px] mx-auto p-2 sm:p-4 space-y-2 text-stone-900 font-sans print:p-0 print:m-0 print:max-w-none">
      {/* 1. Full-width Top SWOT Strip */}
      <div className="border border-stone-300 rounded bg-stone-50/80 p-2 shadow-2xs">
        <div className="flex items-center justify-between border-b border-stone-200 pb-1 mb-1.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-stone-800">
            SWOT Analysis
          </h2>
          <span className="text-2xs text-stone-500">Strengths, Weaknesses, Trends</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {renderCellBlock("SWT-1")}
          {renderCellBlock("SWT-2")}
          {renderCellBlock("SWT-3")}
        </div>
      </div>

      {/* 2. Seven Column Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-2 items-start">
        {/* Col 1: Values */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Values</h3>
            <span className="text-3xs text-stone-500">Should / Shouldn&apos;t</span>
          </div>
          <div className="space-y-1.5">{renderCellBlock("CV")}</div>
        </div>

        {/* Col 2: Purpose */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Purpose</h3>
            <span className="text-3xs text-stone-500">Why</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("PU-1")}
            {renderCellBlock("PU-2")}
          </div>
        </div>

        {/* Col 3: Targets */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Targets</h3>
            <span className="text-3xs text-stone-500">3-5 Yrs / Where</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("T35-1")}
            {renderCellBlock("T35-2")}
            {renderCellBlock("T35-3")}
            {renderCellBlock("T35-3b")}
            {renderCellBlock("T35-4")}
            {renderCellBlock("T35-5")}
            {renderCellBlock("T35-6")}
          </div>
        </div>

        {/* Col 4: Goals */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Goals</h3>
            <span className="text-3xs text-stone-500">1 Yr / What</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("G1-1")}
            {renderCellBlock("G1-2")}
            {renderCellBlock("G1-3")}
            {renderCellBlock("G1-4")}
            {renderCellBlock("G1-5")}
          </div>
        </div>

        {/* Col 5: Actions */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Actions</h3>
            <span className="text-3xs text-stone-500">Qtr / How</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("A90-1")}
            {renderCellBlock("A90-2")}
            {renderCellBlock("A90-3")}
            {renderCellBlock("A90-4")}
            {renderCellBlock("A90-5")}
          </div>
        </div>

        {/* Col 6: Theme */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Theme</h3>
            <span className="text-3xs text-stone-500">Who</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("TH-1")}
            {renderCellBlock("TH-2")}
            {renderCellBlock("TH-3")}
            {renderCellBlock("TH-4")}
            {renderCellBlock("TH-5")}
            {renderCellBlock("TH-6")}
            {renderCellBlock("TH-7")}
          </div>
        </div>

        {/* Col 7: Accountability */}
        <div className="flex flex-col gap-1.5 border border-stone-300 rounded bg-stone-50/60 p-1.5">
          <div className="border-b border-stone-200 pb-1">
            <h3 className="text-xs font-bold uppercase tracking-tight text-stone-800">Accountability</h3>
            <span className="text-3xs text-stone-500">Who / When</span>
          </div>
          <div className="space-y-1.5">
            {renderCellBlock("AC-1")}
            {renderCellBlock("AC-2")}
          </div>
        </div>
      </div>
    </div>
  );
}
