"use client";

import { useState } from "react";
import type { FunctionId } from "@/lib/questions";
import type { CohortMember } from "@/lib/cohort";
import {
  FUNCTION_CAP_MESSAGE,
  FUNCTION_ID_LIST,
  FUNCTION_LABELS,
  MAX_FUNCTION_CHIPS,
  PRIVATE_PANEL_BODY,
  PRIVATE_PANEL_HEADING,
  PRIVATE_PANEL_OPTIONAL,
  PRIVATE_PANEL_PROMPT,
  emptyQ14Draft,
  type Q14Draft,
} from "@/lib/q14";

// Capped multi-select + hours slider + private field input (F03-T09, FR-10,
// ui_ux.md §4.11, anakloud-baseline-questions.md Q14) for Q14 — four parts on
// one screen.
//
// (a) The sixteen functions as chips, at most three selected. The cap is the
// design: once three are chosen the rest dim, but a dimmed chip is still tapped
// — and tapping one shows "Pick at most 3 — swap one out." rather than silently
// doing nothing. None of the sixteen is visually distinguished, reordered or
// emphasised (ui_ux §4.11): the chips render uniformly, so a subset — the ones
// a dev team never volunteers for — cannot be signalled as more or less wanted
// before the respondent has spoken.
//
// (b) One short field per teammate, names pre-filled from the cohort roster, in
// which the respondent names the one function they think that teammate owns.
// The stored shape keys by respondent id; the row label is the teammate's name.
//
// (c) An hours slider 0–60 whose value is shown large, paired with a numeric
// input (ui_ux §7). It starts **unset** — a default would be an anchor, and the
// baseline calls the hours spread "the most important number on this entire
// form". Until a value is set the thumb is hidden and the big readout shows a
// dash, so the unset state is visible rather than masquerading as 0.
//
// (d) The private field: a visually distinct inset panel with a lock glyph and
// the §4.11(d) copy verbatim. It states on the field itself that only the
// facilitator sees it and that it appears in no comparison and no export, it is
// optional and says so. F01-T03 already splits `private_note` to its own
// `is_private = true` row at persist time, so the component only collects it.

const chipClass =
  "min-h-11 rounded-md border border-neutral-300 bg-white px-3 py-2 text-base font-medium text-neutral-800 hover:border-neutral-500";
const chipSelectedClass =
  "min-h-11 rounded-md border border-neutral-900 bg-neutral-900 px-3 py-2 text-base font-medium text-white";
const chipDimmedClass =
  "min-h-11 cursor-not-allowed rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-base font-medium text-neutral-400";

const fieldClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400";

export function Q14Input({
  value,
  onChange,
  teammates,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: Q14Draft;
  onChange: (value: Q14Draft) => void;
  /** The cohort roster minus the respondent, pre-filling the (b) row names. */
  teammates: readonly CohortMember[];
}) {
  const [draft, setDraft] = useState<Q14Draft>(() => {
    const empty = emptyQ14Draft(teammates);
    return {
      wants: value?.wants ?? [],
      // Robust against a roster change between loads: start from an empty draft
      // for the current teammates, then overlay any already-saved row values.
      others: { ...empty.others, ...(value?.others ?? {}) },
      hours: value?.hours ?? null,
      privateNote: value?.privateNote ?? "",
    };
  });
  const [capMessageVisible, setCapMessageVisible] = useState(false);
  const atCap = draft.wants.length >= MAX_FUNCTION_CHIPS;

  function report(next: Q14Draft) {
    setDraft(next);
    onChange(next);
  }

  function toggleFunction(id: FunctionId) {
    const selected = draft.wants.includes(id);
    if (!selected && atCap) {
      // A dimmed chip was tapped: show the cap line, never silently ignore it.
      setCapMessageVisible(true);
      return;
    }
    setCapMessageVisible(false);
    const wants = selected
      ? draft.wants.filter((x) => x !== id)
      : [...draft.wants, id];
    report({ ...draft, wants });
  }

  function setHours(hours: number | null) {
    report({ ...draft, hours });
  }

  return (
    <div className="flex flex-col gap-8" data-testid="q14">
      {/* (a) Function chips, at most three. */}
      <div>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold text-neutral-800">
            Pick up to three functions you want to own.
          </legend>
          <div
            data-testid="function-chips"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {FUNCTION_ID_LIST.map((id) => {
              const selected = draft.wants.includes(id);
              const dimmed = !selected && atCap;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleFunction(id)}
                  className={`${selected ? chipSelectedClass : dimmed ? chipDimmedClass : chipClass}`}
                >
                  {FUNCTION_LABELS[id]}
                </button>
              );
            })}
          </div>
          {/* The cap line, shown only while a dimmed chip was tapped. */}
          {capMessageVisible && (
            <p data-testid="cap-message" className="text-base text-neutral-600">
              {FUNCTION_CAP_MESSAGE}
            </p>
          )}
        </fieldset>
      </div>

      {/* (b) One short field per teammate, names pre-filled from the roster. */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-base font-semibold text-neutral-800">
          For each teammate, the one function you think they own.
        </legend>
        {teammates.map((teammate) => {
          const selectId = `q14-others-${teammate.id}`;
          const current = draft.others[teammate.id];
          return (
            <div key={teammate.id}>
              <label
                htmlFor={selectId}
                className="block text-base font-medium text-neutral-700"
              >
                {teammate.displayName}
              </label>
              <select
                id={selectId}
                value={current ?? ""}
                onChange={(e) =>
                  report({
                    ...draft,
                    others: {
                      ...draft.others,
                      [teammate.id]:
                        (e.target.value as FunctionId) || null,
                    },
                  })
                }
                className={`${fieldClass} mt-1`}
              >
                <option value="">Not sure yet</option>
                {FUNCTION_ID_LIST.map((id) => (
                  <option key={id} value={id}>
                    {FUNCTION_LABELS[id]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </fieldset>

      {/* (c) Hours slider, unset by default, value shown large. */}
      <div data-testid="hours-box">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-semibold text-neutral-800">
            Realistically, how many hours a week can you give Anakloud from
            October 2026?
          </legend>
          <div className="flex items-center gap-4">
            <span
              data-testid="hours-value"
              className="min-w-16 text-left text-4xl font-semibold tabular-nums text-neutral-900"
            >
              {draft.hours !== null ? draft.hours : "—"}
            </span>
            <div
              className="q14-hours flex-1"
              data-set={draft.hours !== null}
            >
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={draft.hours ?? 0}
                aria-label="Hours per week"
                aria-valuetext={
                  draft.hours !== null ? `${draft.hours} hours` : "unset"
                }
                onChange={(e) => setHours(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <label htmlFor="q14-hours-number" className="sr-only">
              Hours per week (number)
            </label>
            <input
              id="q14-hours-number"
              type="number"
              min={0}
              max={60}
              value={draft.hours !== null ? draft.hours : ""}
              placeholder={draft.hours !== null ? undefined : "—"}
              onChange={(e) =>
                setHours(
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              className="w-20 rounded-md border border-neutral-300 bg-white px-3 py-2 text-center text-base tabular-nums text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400"
            />
          </div>
        </fieldset>
      </div>

      {/* (d) The private field, a distinct inset panel with the §4.11 copy. */}
      <div
        data-testid="private-panel"
        className="rounded-md border border-neutral-300 bg-neutral-50 px-5 py-4"
      >
        <div className="flex items-start gap-3">
          <LockGlyph />
          <div className="flex flex-col gap-1">
            <p className="text-base font-semibold text-neutral-900">
              {PRIVATE_PANEL_HEADING}
            </p>
            <p className="text-base text-neutral-700">{PRIVATE_PANEL_BODY}</p>
          </div>
        </div>
        <label
          htmlFor="q14-private"
          className="mt-4 block text-base font-medium text-neutral-700"
        >
          {PRIVATE_PANEL_PROMPT}
        </label>
        <textarea
          id="q14-private"
          rows={3}
          value={draft.privateNote}
          onChange={(e) => report({ ...draft, privateNote: e.target.value })}
          className={`${fieldClass} mt-2`}
        />
        <p className="mt-2 text-sm text-neutral-500">
          ({PRIVATE_PANEL_OPTIONAL})
        </p>
      </div>
    </div>
  );
}

/** The lock glyph in the private panel (ui_ux §4.11) — an SVG, not text. */
function LockGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6 shrink-0 text-neutral-700"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}