"use client";

import { useState } from "react";
import type { Q2Value } from "@/lib/questions";
import {
  Q2_BECAUSE_LABEL,
  Q2_WHO_LABEL,
} from "@/lib/sentence-completion";

// Sentence-completion input (F03-T03, FR-10, ui_ux.md §4.5) for Q2.
//
// Q2 is a single sentence with two inline blanks: "The people who would miss
// it most are ▬, because ▬." On wide viewports the blanks render inline as
// underlined runs inside the sentence, so the grammar reads as one statement.
// On narrow viewports the fragments stack vertically, each carrying its
// sentence fragment as a label above it — the sentence structure is what does
// the cognitive work and it must not collapse into two anonymous boxes at any
// width. The same value is held in one piece of state and reported up as the
// §3.1 `{ who, because }` shape; the desktop and mobile presentations are two
// renderings of that single value, toggled by responsive visibility. Whichever
// is displayed sets the inputs' accessible name to its sentence fragment, so a
// screen reader hears the sentence structure, not two generic text fields.
//
// "Answered" is computed by the shell from the emitted value (both blanks
// trimmed non-empty), so this component never blocks or decides navigation
// itself (PR4, D2).

// The two underlined runs sit in 44px-tall hit areas (ui_ux §7) so a thumb
// lands inside a blank even when it misses the narrow underline.
const inputRunClass =
  "min-h-[44px] border-b-2 border-neutral-400 bg-transparent px-2 py-1 text-base font-medium text-neutral-900 focus:border-cobalt-600 focus:outline-none transition-colors";

export function SentenceCompletionInput({
  value,
  onChange,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: Q2Value;
  onChange: (value: Q2Value) => void;
}) {
  const [values, setValues] = useState<Q2Value>(() => ({
    who: value?.who ?? "",
    because: value?.because ?? "",
  }));

  // Each handler updates its field AND re-emits the whole `{ who, because }`
  // shape. The functional update reads the latest committed value of the other
  // field, so a rapid sequence of fills can never cross-read a stale half from
  // a previous render's closure — the emitted answer always holds both.
  function setWho(raw: string) {
    setValues((current) => {
      const next = { who: raw, because: current.because };
      onChange(next);
      return next;
    });
  }

  function setBecause(raw: string) {
    setValues((current) => {
      const next = { who: current.who, because: raw };
      onChange(next);
      return next;
    });
  }

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
      {/* Wide viewport: the two blanks run inline, underlined, inside the
          sentence. */}
      <p
        data-testid="q2-sentence-inline"
        className="hidden text-lg leading-loose text-neutral-900 md:block"
      >
        {Q2_WHO_LABEL}{" "}
        <input
          type="text"
          value={values.who}
          onChange={(e) => setWho(e.target.value)}
          aria-label={Q2_WHO_LABEL}
          className={`${inputRunClass} w-48`}
        />{" "}
        , because{" "}
        <input
          type="text"
          value={values.because}
          onChange={(e) => setBecause(e.target.value)}
          aria-label={Q2_BECAUSE_LABEL}
          className={`${inputRunClass} w-64`}
        />{" "}
        .
      </p>

      {/* Narrow viewport: stacked fragments, each labelled with its sentence
          fragment above it. */}
      <div
        data-testid="q2-sentence-stacked"
        className="flex flex-col gap-5 md:hidden"
      >
        <div>
          <label
            htmlFor="q2-who-mobile"
            className="block text-sm font-semibold text-neutral-700 mb-1.5"
          >
            {Q2_WHO_LABEL}
          </label>
          <input
            id="q2-who-mobile"
            type="text"
            value={values.who}
            onChange={(e) => setWho(e.target.value)}
            aria-label={Q2_WHO_LABEL}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
          />
        </div>

        <div>
          <label
            htmlFor="q2-because-mobile"
            className="block text-sm font-semibold text-neutral-700 mb-1.5"
          >
            {Q2_BECAUSE_LABEL}
          </label>
          <input
            id="q2-because-mobile"
            type="text"
            value={values.because}
            onChange={(e) => setBecause(e.target.value)}
            aria-label={Q2_BECAUSE_LABEL}
            className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
          />
        </div>
      </div>
    </div>
  );
}