"use client";

import { type Q9ValueType } from "@/lib/questions";
import { q9FieldLabel } from "@/lib/q9";

// Three-short-fields input for Q9 (F03-T10, anakloud-baseline-questions.md
// Q9). Three separate labelled lines, all required, persisted as a three-item
// tuple `{ items: [string, string, string] }`. Each field carries its own
// numbered label ("Not doing 1") so none is an anonymous box — the three
// refusals are read as a set of three, and the label keeps them distinct for a
// screen reader and on a phone alike.
//
// No placeholder text on any field: placeholders anchor. The question's own
// helper text explains the job. The "all three required" rule is enforced by
// the shell's navigation gate (q9IsAnswered), never by this component blocking
// or deciding navigation itself (PR4, D2).

const fieldClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400";

export function Q9Input({
  value,
  onChange,
}: {
  /** Existing value to seed the three fields (empty until persistence exists). */
  value?: Q9ValueType;
  onChange: (value: Q9ValueType) => void;
}) {
  const items: [string, string, string] = value?.items ?? ["", "", ""];

  function setItem(index: 0 | 1 | 2, next: string) {
    const updated: [string, string, string] = [...items];
    updated[index] = next;
    onChange({ items: updated });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="q9-triple">
      {([0, 1, 2] as const).map((index) => (
        <div key={index}>
          <label
            htmlFor={`q9-not-doing-${index + 1}`}
            className="block text-base font-medium text-neutral-700"
          >
            {q9FieldLabel((index + 1) as 1 | 2 | 3)}
          </label>
          <input
            id={`q9-not-doing-${index + 1}`}
            type="text"
            autoComplete="off"
            value={items[index]}
            onChange={(e) => setItem(index, e.target.value)}
            className={`${fieldClass} mt-1`}
          />
        </div>
      ))}
    </div>
  );
}