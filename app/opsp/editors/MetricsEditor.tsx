"use client";

interface MetricsEditorProps {
  value: Record<string, string>;
  rowLabels?: string[];
  onChange: (val: Record<string, string>) => void;
}

export function MetricsEditor({
  value = {},
  rowLabels = ["Paying centers", "Active children", "MRR", "Team size"],
  onChange,
}: MetricsEditorProps) {
  const current = typeof value === "object" && value !== null ? value : {};

  const handleChange = (label: string, text: string) => {
    onChange({
      ...current,
      [label]: text,
    });
  };

  return (
    <div className="space-y-3 w-full">
      {rowLabels.map((label) => (
        <div key={label} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
          <label className="text-xs font-medium text-stone-700">{label}</label>
          <div className="sm:col-span-2">
            <input
              type="text"
              value={current[label] ?? ""}
              onChange={(e) => handleChange(label, e.target.value)}
              className="w-full rounded border border-stone-300 bg-white px-3 py-1.5 text-stone-900 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
