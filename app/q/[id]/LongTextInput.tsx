"use client";

import { useEffect, useRef, useState } from "react";
import {
  Q13_CAUSES,
  type LongTextQuestionId,
  type LongTextValue,
  type Q13Cause,
} from "@/lib/questions";
import { charCountLabel, Q1_MIN_CHARS } from "@/lib/long-text";

// Long-text input (F03-T02, FR-10, ui_ux.md §4.4) for Q1, Q13 and Q15.
//
// One auto-growing textarea with a minimum of six visible lines at a 1.6 line
// height, and deliberately no placeholder — a placeholder anchors as hard as a
// worked example does (ui_ux.md §4.3), so nothing of the sort appears here; the
// helper text already renders above the field. A character counter appears only
// where a minimum applies (Q1: 200) and counts up to that minimum ("142 of 200",
// never "58 remaining"). Q13 additionally carries the single-choice cause below
// the textarea; both halves are held in local state and reported up together as
// the §3.1 `{ text, cause }` shape, so the value the shell sees always holds the
// free text and the selected cause together.
//
// "Answered" is computed by the shell from the emitted value (non-empty text),
// so this component never blocks or decides navigation itself (PR4, D2).

export function LongTextInput({
  questionId,
  value,
  onChange,
}: {
  questionId: LongTextQuestionId;
  /** Existing value to seed the field (empty until persistence exists). */
  value?: LongTextValue;
  onChange: (value: LongTextValue) => void;
}) {
  const isQ13 = questionId === "q13";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [text, setText] = useState(() => value?.text ?? "");
  const [cause, setCause] = useState<Q13Cause | "">(() =>
    isQ13 ? ((value as { cause?: Q13Cause } | undefined)?.cause ?? "") : "",
  );

  // Auto-grow: after the text changes, collapse then re-expand to fit the
  // content. The "auto" reset lets the field shrink when text is deleted; the
  // floor of six lines (the min-height below) keeps it from collapsing into a
  // sliver while the respondent is thinking.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  // The counter appears only where a minimum applies (Q1: 200, ui_ux §4.4).
  // Q13 and Q15 have no minimum, so they carry no counter.
  const minChars = questionId === "q1" ? Q1_MIN_CHARS : undefined;

  function handleTextChange(raw: string) {
    setText(raw);
    if (isQ13) {
      onChange({ text: raw, cause: cause as Q13Cause });
    } else {
      onChange({ text: raw });
    }
  }

  function handleCauseSelect(selected: Q13Cause) {
    setCause(selected);
    if (isQ13) {
      onChange({ text, cause: selected });
    }
  }

  return (
    <div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={6}
        style={{ lineHeight: 1.6, minHeight: "9.6em" }}
        className="w-full resize-y overflow-hidden rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
        aria-label={isQ13 ? "Your explanation" : "Your answer"}
      />

      {minChars !== undefined && (
        <p
          data-testid="long-text-counter"
          className="mt-2 text-sm tabular-nums text-neutral-500"
        >
          {charCountLabel(text.length, minChars)}
        </p>
      )}

      {isQ13 && (
        <fieldset data-testid="q13-cause" className="mt-5">
          <legend className="text-base font-medium text-neutral-700">
            Most likely cause
          </legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {Q13_CAUSES.map((option) => (
              <label
                key={option}
                className="flex min-h-11 items-center gap-2 rounded-md px-1 py-1 text-neutral-700"
              >
                <input
                  type="radio"
                  name="q13-cause"
                  value={option}
                  checked={cause === option}
                  onChange={() => handleCauseSelect(option)}
                  className="mt-0.5 h-5 w-5 shrink-0"
                />
                <span className="min-h-5 text-sm leading-5">{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}