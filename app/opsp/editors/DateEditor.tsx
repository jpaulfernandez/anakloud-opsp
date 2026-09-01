"use client";

interface DateEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export function DateEditor({ value, onChange }: DateEditorProps) {
  return (
    <div className="w-full max-w-sm">
      <input
        type="text"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded border border-stone-300 bg-white px-3 py-1.5 text-stone-900 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
      />
    </div>
  );
}
