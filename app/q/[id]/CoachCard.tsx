"use client";

import { useState } from "react";

// The coach card (F05-T04, ui_ux.md §5.1, §5.2, D2, spec.md FR-16…FR-19).
//
// Rendered in the shell's §4.3 "coach" slot, directly below the answer field,
// only when the respondent activates Continue on a coachable question and the
// deterministic verdict is needs_work. It sits beside the answer, never in
// front of it: it is not a modal, it does not steal focus from the field, it
// does not disable Continue, and it does not move the page. The cardinal rule
// on the outside is PR4 / D2 — this card nudges, it never gates.
//
// Every nudge carries three actions and the honest attempt counter (FR-18,
// ui_ux §5.2): let me revise, show me an example, and "Keep it as is →". The
// example action is only offered where a static example exists (Q3, Q7, Q11 —
// F05-T02 / spec.md §7.1); a control that could present nothing would be worse
// than the action being absent. Examples expand in place, clearly labelled as
// a shape rather than a suggestion (FR-19).
//
// The card is announced via the shell's coach slot, which already carries
// `aria-live="polite"` (ui_ux §5.2), so inserting it is read without a modal
// or a focus grab.

const buttonClass =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50";

export function CoachCard({
  hint,
  example,
  nudge,
  onRevise,
  onShowExample,
  onKeepAsIs,
}: {
  hint: string;
  /** Present only for the example-bearing questions (Q3, Q7, Q11). */
  example?: string;
  /** 1..3 — the current nudge number. */
  nudge: number;
  onRevise: () => void;
  /** Called the first time the respondent asks for an example (F05-T05 logging). */
  onShowExample?: () => void;
  onKeepAsIs: () => void;
}) {
  const [exampleOpen, setExampleOpen] = useState(false);

  return (
    <div
      data-testid="coach-card"
      role="status"
      className="rounded-md border border-neutral-300 bg-neutral-50 p-4"
    >
      <p className="text-sm leading-relaxed text-neutral-700">{hint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-action="revise"
          className={buttonClass}
          onClick={onRevise}
        >
          Let me revise
        </button>
        {example && (
          <button
            type="button"
            data-action="example"
            className={buttonClass}
            aria-expanded={exampleOpen}
            onClick={() => {
              if (!exampleOpen) {
                onShowExample?.();
                setExampleOpen(true);
              }
            }}
          >
            Show me an example
          </button>
        )}
        <button
          type="button"
          data-action="keep"
          className={buttonClass}
          onClick={onKeepAsIs}
        >
          Keep it as is →
        </button>
      </div>

      {exampleOpen && example && (
        <div data-testid="coach-example" className="mt-3 border-t border-neutral-200 pt-3">
          <h2 className="text-sm font-semibold text-neutral-800">
            The shape, not a suggestion:
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            {example}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-neutral-500">nudge {nudge} of 3</p>
    </div>
  );
}