"use client";

interface ListEditorProps {
  value: string[];
  maxRows?: number;
  onChange: (val: string[]) => void;
}

export function ListEditor({ value = [], maxRows = 5, onChange }: ListEditorProps) {
  const items = Array.isArray(value) ? value : [];

  const handleItemChange = (index: number, text: string) => {
    const updated = [...items];
    updated[index] = text;
    onChange(updated);
  };

  const handleAddItem = () => {
    onChange([...items, ""]);
  };

  const handleRemoveItem = (index: number) => {
    const updated = items.filter((_, i) => i !== index);
    onChange(updated);
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const updated = [...items];
      updated.splice(index + 1, 0, "");
      onChange(updated);
    }
  };

  const isAtSoftCap = items.length >= maxRows;

  return (
    <div className="space-y-2.5 w-full">
      {items.length === 0 && (
        <button
          type="button"
          onClick={handleAddItem}
          className="text-xs text-stone-600 hover:text-stone-900 border border-dashed border-stone-300 rounded px-3 py-1.5 hover:bg-stone-50"
        >
          + Add first item
        </button>
      )}

      {items.map((item, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <span className="text-xs font-mono text-stone-400 w-5 text-right">{idx + 1}.</span>
          <input
            type="text"
            value={item}
            onChange={(e) => handleItemChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            className="flex-1 rounded border border-stone-300 bg-white px-3 py-1.5 text-stone-900 text-sm focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
          />
          <button
            type="button"
            onClick={() => handleRemoveItem(idx)}
            className="text-stone-400 hover:text-stone-700 text-sm px-1.5 py-1 rounded"
            title="Remove item"
          >
            ×
          </button>
        </div>
      ))}

      <div className="pt-1 flex items-center justify-between">
        {!isAtSoftCap ? (
          <button
            type="button"
            onClick={handleAddItem}
            className="text-xs text-stone-600 hover:text-stone-900 font-medium py-1 px-2 rounded border border-stone-200 hover:bg-stone-50"
          >
            + Add item
          </button>
        ) : (
          <span className="text-xs text-stone-400 italic">
            {maxRows} is the usual maximum.
          </span>
        )}
      </div>
    </div>
  );
}
