"use client";

interface TableEditorProps {
  value: Array<Record<string, string>>;
  columns?: string[];
  maxRows?: number;
  onChange: (val: Array<Record<string, string>>) => void;
}

export function TableEditor({
  value = [],
  columns = ["Column 1", "Column 2"],
  maxRows = 5,
  onChange,
}: TableEditorProps) {
  const rows = Array.isArray(value) ? value : [];

  const handleCellChange = (rowIndex: number, col: string, text: string) => {
    const updated = [...rows];
    updated[rowIndex] = {
      ...(updated[rowIndex] ?? {}),
      [col]: text,
    };
    onChange(updated);
  };

  const handleAddRow = () => {
    const emptyRow: Record<string, string> = {};
    for (const c of columns) emptyRow[c] = "";
    onChange([...rows, emptyRow]);
  };

  const handleRemoveRow = (index: number) => {
    const updated = rows.filter((_, i) => i !== index);
    onChange(updated);
  };

  const isAtSoftCap = rows.length >= maxRows;

  return (
    <div className="space-y-3 w-full">
      {rows.length === 0 ? (
        <button
          type="button"
          onClick={handleAddRow}
          className="text-xs text-stone-600 hover:text-stone-900 border border-dashed border-stone-300 rounded px-3 py-1.5 hover:bg-stone-50"
        >
          + Add first row
        </button>
      ) : (
        <div className="overflow-x-auto border border-stone-200 rounded">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-stone-100 border-b border-stone-200">
                <th className="p-2 w-8 text-stone-500 font-mono">#</th>
                {columns.map((col) => (
                  <th key={col} className="p-2 font-medium text-stone-700">
                    {col}
                  </th>
                ))}
                <th className="p-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={rIdx} className="border-b border-stone-200 last:border-0 hover:bg-stone-50/50">
                  <td className="p-2 text-stone-400 font-mono">{rIdx + 1}</td>
                  {columns.map((col) => (
                    <td key={col} className="p-1.5">
                      <input
                        type="text"
                        value={row[col] ?? ""}
                        onChange={(e) => handleCellChange(rIdx, col, e.target.value)}
                        className="w-full rounded border border-stone-300 bg-white px-2.5 py-1 text-stone-900 text-xs focus:border-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-500"
                      />
                    </td>
                  ))}
                  <td className="p-1.5 text-center">
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(rIdx)}
                      className="text-stone-400 hover:text-stone-700 text-sm px-1 rounded"
                      title="Remove row"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pt-1 flex items-center justify-between">
        {!isAtSoftCap ? (
          <button
            type="button"
            onClick={handleAddRow}
            className="text-xs text-stone-600 hover:text-stone-900 font-medium py-1 px-2 rounded border border-stone-200 hover:bg-stone-50"
          >
            + Add row
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
