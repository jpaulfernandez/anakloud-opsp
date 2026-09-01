"use client";

import { useState } from "react";

interface MetricsEditorProps {
  value: Record<string, string> | Array<{ label: string; value: string }>;
  rowLabels?: string[];
  onChange: (val: Record<string, string>) => void;
}

interface MetricRow {
  id: string;
  label: string;
  value: string;
}

export function MetricsEditor({
  value = {},
  rowLabels = ["Paying centers", "Active children", "MRR", "Team size"],
  onChange,
}: MetricsEditorProps) {
  const [rows, setRows] = useState<MetricRow[]>(() => {
    if (Array.isArray(value)) {
      return value.map((r, i) => ({
        id: `row-${i}-${Date.now()}`,
        label: r.label ?? "",
        value: r.value ?? "",
      }));
    }
    if (typeof value === "object" && value !== null && Object.keys(value).length > 0) {
      return Object.entries(value).map(([k, v], i) => ({
        id: `row-${i}-${Date.now()}`,
        label: k,
        value: String(v ?? ""),
      }));
    }
    return rowLabels.map((lbl, i) => ({
      id: `row-${i}-${Date.now()}`,
      label: lbl,
      value: "",
    }));
  });

  // Sync rows to parent dictionary
  const notifyChange = (updatedRows: MetricRow[]) => {
    const dict: Record<string, string> = {};
    for (const r of updatedRows) {
      if (r.label.trim()) {
        dict[r.label] = r.value;
      }
    }
    onChange(dict);
  };

  const handleLabelChange = (id: string, newLabel: string) => {
    const updated = rows.map((r) => (r.id === id ? { ...r, label: newLabel } : r));
    setRows(updated);
    notifyChange(updated);
  };

  const handleValueChange = (id: string, newVal: string) => {
    const updated = rows.map((r) => (r.id === id ? { ...r, value: newVal } : r));
    setRows(updated);
    notifyChange(updated);
  };

  const handleAddRow = () => {
    const newRow: MetricRow = {
      id: `row-${Date.now()}-${Math.random()}`,
      label: "",
      value: "",
    };
    const updated = [...rows, newRow];
    setRows(updated);
    notifyChange(updated);
  };

  const handleRemoveRow = (id: string) => {
    const updated = rows.filter((r) => r.id !== id);
    setRows(updated);
    notifyChange(updated);
  };

  const softCap = 5;
  const isOverSoftCap = rows.length >= softCap;

  return (
    <div className="space-y-3 w-full">
      <div className="flex items-center justify-between text-2xs text-stone-500 mb-1 border-b border-stone-200 pb-1">
        <span>Define your key metrics and target numbers. You can edit metric names, add new rows, or remove metrics.</span>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <div className="w-1/2">
              <input
                type="text"
                value={row.label}
                placeholder={`Metric name (e.g. MRR, Centers)`}
                onChange={(e) => handleLabelChange(row.id, e.target.value)}
                className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 text-stone-900 text-xs font-medium focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
            </div>
            <div className="w-1/2 flex items-center gap-1.5">
              <input
                type="text"
                value={row.value}
                placeholder="Target value (e.g. ₱2.5M, 300)"
                onChange={(e) => handleValueChange(row.id, e.target.value)}
                className="w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 text-stone-900 text-xs focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
              />
              <button
                type="button"
                onClick={() => handleRemoveRow(row.id)}
                title="Remove metric"
                className="text-stone-400 hover:text-red-600 px-1.5 py-1 rounded text-xs transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>

      {isOverSoftCap ? (
        <p className="text-2xs text-stone-400 italic pt-1">
          {softCap} key numbers is the usual maximum for focus.
        </p>
      ) : (
        <button
          type="button"
          onClick={handleAddRow}
          className="inline-flex items-center gap-1 text-xs text-stone-700 hover:text-stone-900 font-medium px-2.5 py-1 rounded border border-stone-300 hover:bg-stone-100 transition-colors mt-1"
        >
          <span>+</span> Add custom metric
        </button>
      )}
    </div>
  );
}
