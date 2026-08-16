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
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:text-neutral-400";

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
      className="flex flex-col gap-5"
      data-testid="single-choice-reason"
    >
      <fieldset>
        <legend className="sr-only">Whose side do we take?</legend>
        <div className="flex flex-col gap-2">
          {Q6_CHOICES.map((choiceId: Q6Choice) => (
            <label
              key={choiceId}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-neutral-300 px-3 py-2.5 text-base text-neutral-800 has-checked:border-neutral-900 has-checked:bg-neutral-50"
            >
              <input
                type="radio"
                name="q6-choice"
                value={choiceId}
                checked={draft.choice === choiceId}
                onChange={() =>
                  setField((current) => ({ ...current, choice: choiceId }))
                }
                className="h-5 w-5 shrink-0 accent-neutral-900"
              />
              <span className="font-medium">{Q6_CHOICE_LABELS[choiceId]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label
          htmlFor="q6-why"
          className="block text-base font-medium text-neutral-700"
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
          className={`${reasonFieldClass} mt-2`}
        />
      </div>
    </div>
  );
}