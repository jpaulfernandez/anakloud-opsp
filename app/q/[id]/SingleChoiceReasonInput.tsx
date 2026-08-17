"use client";

import { useState } from "react";
import { Q6_CHOICES, type Q6Choice } from "@/lib/questions";
import {
  Q6_CHOICE_LABELS,
  type SingleChoiceReasonDraft,
} from "@/lib/single-choice-reason";

// Single-choice + required-reason input (F03-T06, FR-10, ui_ux.md §4.9) for Q6.
//
// A radio group of four options followed by a reason textarea that stays
// disabled until a choice is made, and which is required once one is (ui_ux
// §4.9: "a textarea that is disabled until a choice is made and required
// after"). The answer persists as `{ choice, why }` (§3.1): the party the
// respondent sides with and their one-line reason.
//
// The reason field is inert before a choice — no tab order, no editable text —
// so the disabled state is literal, not a placeholder (an open-but-disabled
// textarea would still suggest the field exists to answer). The shell derives
// both "answered" and the blocked message from the draft the component emits:
// Continue is refused with "Add a line about why" when the reason is empty,
// not with a generic greyed-out button (PR4, D2).

const reasonFieldClass =
  "w-full min-h-[96px] rounded-xl border border-neutral-300 bg-white p-3.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20 disabled:cursor-not-allowed disabled:bg-neutral-100/70 disabled:text-neutral-400 disabled:border-neutral-200";

export function SingleChoiceReasonInput({
  value,
  onChange,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: SingleChoiceReasonDraft;
  onChange: (value: SingleChoiceReasonDraft) => void;
}) {
  const [draft, setDraft] = useState<SingleChoiceReasonDraft>(() => ({
    choice: value?.choice ?? null,
    why: value?.why ?? "",
  }));

  function setField(
    update: (current: SingleChoiceReasonDraft) => SingleChoiceReasonDraft,
  ) {
    setDraft((current) => {
      const next = update(current);
      onChange(next);
      return next;
    });
  }

  const hasChoice = draft.choice !== null;

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="single-choice-reason"
    >
      <fieldset className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <legend className="sr-only">Whose side do we take?</legend>
        <div className="flex flex-col gap-2.5">
          {Q6_CHOICES.map((choiceId: Q6Choice) => (
            <label
              key={choiceId}
              className="flex min-h-[48px] cursor-pointer items-center gap-3.5 rounded-xl border border-neutral-200 px-4 py-3 text-base text-neutral-800 transition-all hover:border-cobalt-300 hover:bg-cobalt-50/20 has-checked:border-cobalt-600 has-checked:bg-cobalt-50/50 has-checked:text-cobalt-950 shadow-subtle"
            >
              <input
                type="radio"
                name="q6-choice"
                value={choiceId}
                checked={draft.choice === choiceId}
                onChange={() =>
                  setField((current) => ({ ...current, choice: choiceId }))
                }
                className="h-4 w-4 shrink-0 text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
              />
              <span className="font-semibold">{Q6_CHOICE_LABELS[choiceId]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <label
          htmlFor="q6-why"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          One line: why
        </label>
        {/* Disabled until a choice is made; the empty state is a disabled field,
            never placeholder text (anchoring, AGENTS.md). Required once a side
            is picked (ui_ux §4.9). */}
        <textarea
          id="q6-why"
          rows={3}
          disabled={!hasChoice}
          required={hasChoice}
          value={draft.why}
          onChange={(e) =>
            setField((current) => ({ ...current, why: e.target.value }))
          }
          className={reasonFieldClass}
        />
      </div>
    </div>
  );
}