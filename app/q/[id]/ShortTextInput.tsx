"use client";

import { type CappedShortTextValue } from "@/lib/questions";
import {
  clampToCap,
  shortTextCounterLabel,
} from "@/lib/short-text";

// Capped short-text input (F03-T10, anakloud-baseline-questions.md Q4, Q7,
// Q12). One single-line field with a hard character cap, enforced *at input*:
// the onChange clamps the typed text to the cap via clampToCap (not merely a
// later validation pass), and a visible live character counter sits beside the
// field, counting up to the cap in the same voice as Q1's minimum counter
// ("32 of 140", never "108 remaining").
//
// There is deliberately no placeholder text. A placeholder would anchor every
// respondent toward a particular promise / BHAG / quarter name (ui_ux §4.3,
// AGENTS.md PR1) — the helper text above the field explains the job instead.
//
// The cap is passed in from the registry via SHORT_TEXT_CAPS so this component
// stays the same shape for all three capped questions (140 / 120 / 40).

const fieldClass =
  "w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20";

export function ShortTextInput({
  cap,
  value,
  onChange,
  inputId,
}: {
  cap: number;
  /** Existing value to seed the field (empty until persistence exists). */
  value?: CappedShortTextValue;
  onChange: (value: CappedShortTextValue) => void;
  /** Stable id linking the label and the input for screen-reader users. */
  inputId: string;
}) {
  const text = clampToCap(value?.text ?? "", cap);

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6 flex flex-col gap-3" data-testid="capped-short-text">
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={inputId}
          className="text-sm font-semibold text-neutral-800"
        >
          Your answer
        </label>
        <span
          aria-live="polite"
          className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-neutral-600"
        >
          {shortTextCounterLabel(clampToCap(text, cap).length, cap)}
        </span>
      </div>
      <input
        id={inputId}
        type="text"
        autoComplete="off"
        data-testid="capped-short-text-input"
        value={text}
        maxLength={cap}
        onChange={(e) => onChange({ text: clampToCap(e.target.value, cap) })}
        className={fieldClass}
      />
    </div>
  );
}