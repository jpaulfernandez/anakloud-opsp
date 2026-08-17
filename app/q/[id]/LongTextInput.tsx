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
    <div className="space-y-4">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => handleTextChange(e.target.value)}
        rows={6}
        style={{ lineHeight: 1.6, minHeight: "9.6em" }}
        className="w-full resize-y overflow-hidden rounded-2xl border border-neutral-300 bg-white p-4 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
        aria-label={isQ13 ? "Your explanation" : "Your answer"}
      />

      {minChars !== undefined && (
        <div className="flex justify-end">
          <p
            data-testid="long-text-counter"
            className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold tabular-nums text-neutral-600"
          >
            {charCountLabel(text.length, minChars)}
          </p>
        </div>
      )}

      {isQ13 && (
        <fieldset data-testid="q13-cause" className="mt-6 space-y-3 rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card">
          <legend className="text-sm font-bold uppercase tracking-wider text-neutral-600">
            Most likely cause
          </legend>
          <div className="flex flex-col gap-2.5">
            {Q13_CAUSES.map((c) => (
              <label
                key={c}
                className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 p-3.5 text-sm font-medium text-neutral-800 transition-all hover:border-cobalt-300 hover:bg-cobalt-50/30 has-checked:border-cobalt-600 has-checked:bg-cobalt-50/50 has-checked:text-cobalt-950"
              >
                <input
                  type="radio"
                  name="q13-cause"
                  value={c}
                  checked={cause === c}
                  onChange={() => handleCauseSelect(c)}
                  className="h-4 w-4 text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}