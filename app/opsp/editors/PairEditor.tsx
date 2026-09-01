"use client";

interface PairEditorProps {
  cellId: string;
  value: { a: string; b: string };
  onChange: (val: { a: string; b: string }) => void;
}

export function PairEditor({ cellId, value = { a: "", b: "" }, onChange }: PairEditorProps) {
  const current = typeof value === "object" && value !== null ? value : { a: "", b: "" };

  const labelA =
    cellId === "T35-6"
      ? "X is (Economic Unit)"
      : cellId === "TH-7"
        ? "Green means"
        : "Slot A";

  const labelB =
    cellId === "T35-6"
      ? "Target (Profit per X)"
      : cellId === "TH-7"
        ? "Red means"
        : "Slot B";

  return (
    <div className="space-y-3 w-full">
      <div className="space-y-1">
        <label className="text-xs font-medium text-stone-700">{labelA}</label>
        <input
          type="text"
          value={current.a ?? ""}
          onChange={(e) => onChange({ ...current, a: e.target.value })}
          className="w-full rounded border border-stone-300 bg-white px-3 py-1.5 text-stone-900 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-stone-700">{labelB}</label>
        <input
          type="text"
          value={current.b ?? ""}
          onChange={(e) => onChange({ ...current, b: e.target.value })}
          className="w-full rounded border border-stone-300 bg-white px-3 py-1.5 text-stone-900 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
        />
      </div>
    </div>
  );
}
