"use client";

interface TextEditorProps {
  value: string;
  onChange: (val: string) => void;
}

export function TextEditor({ value, onChange }: TextEditorProps) {
  return (
    <div className="w-full">
      <textarea
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={6}
        className="w-full rounded-md border border-stone-300 bg-white p-3 text-stone-900 text-sm leading-relaxed focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
      />
    </div>
  );
}
