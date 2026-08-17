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
  "min-h-[48px] rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-subtle hover:border-cobalt-300 hover:bg-cobalt-50/20 active:scale-[0.98] transition-all";
const chipSelectedClass =
  "min-h-[48px] rounded-xl border border-cobalt-600 bg-cobalt-600 px-3 py-2 text-sm font-semibold text-white shadow-cobalt active:scale-[0.98] transition-all";
// The dimmed chip stays a fully real, tappable control (F03-T09: dimming is
// visual only — a tap still explains itself instead of silently no-oping), so
// its label must keep the 4.5:1 contrast floor rather than relying on a
// disabled-control exemption. Text is muted to neutral-600 on neutral-100
// (≈7:1) and the border thinned to neutral-200, which reads as "dimmed" next
// to a white chip whose text is neutral-800, without dropping illegible.
const chipDimmedClass =
  "min-h-[48px] cursor-pointer rounded-xl border border-neutral-200 bg-neutral-100/80 px-3 py-2 text-sm font-medium text-neutral-500 transition-all";

const fieldClass =
  "w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20";

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
    <div className="flex flex-col gap-6" data-testid="q14">
      {/* (a) Function chips, at most three. */}
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-base font-bold text-neutral-900">
            Pick up to three functions you want to own.
          </legend>
          <div
            data-testid="function-chips"
            className="grid grid-cols-2 gap-2.5 sm:grid-cols-3"
          >
            {FUNCTION_ID_LIST.map((id) => {
              const selected = draft.wants.includes(id);
              const dimmed = !selected && atCap;
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`function-chip-${id}`}
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
            <p data-testid="cap-message" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-900">
              {FUNCTION_CAP_MESSAGE}
            </p>
          )}
        </fieldset>
      </div>

      {/* (b) One short field per teammate, names pre-filled from the roster. */}
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="text-base font-bold text-neutral-900">
            For each teammate, the one function you think they own.
          </legend>
          <div className="flex flex-col gap-3">
            {teammates.map((teammate) => {
              const selectId = `q14-others-${teammate.id}`;
              const current = draft.others[teammate.id];
              return (
                <div key={teammate.id} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <label
                    htmlFor={selectId}
                    className="block text-sm font-semibold text-neutral-800 sm:w-1/3"
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
                    className={`${fieldClass} sm:flex-1`}
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
          </div>
        </fieldset>
      </div>

      {/* (c) Hours slider, unset by default, value shown large. */}
      <div data-testid="hours-box" className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <fieldset className="flex flex-col gap-4">
          <legend className="text-base font-bold text-neutral-900">
            Realistically, how many hours a week can you give Anakloud from
            October 2026?
          </legend>
          <div className="flex items-center gap-4">
            <span
              data-testid="hours-value"
              className="min-w-16 text-center text-4xl font-extrabold tabular-nums text-cobalt-700 bg-cobalt-50/80 py-2 px-3 rounded-2xl border border-cobalt-200/60"
            >
              {draft.hours !== null ? draft.hours : "—"}
            </span>
            <div
              className="q14-hours flex-1"
              data-set={draft.hours !== null}
            >
              <input
                id="q14-hours-slider"
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
              className="h-11 w-16 rounded-xl border border-neutral-300 bg-white px-2 py-1 text-center font-bold tabular-nums text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
            />
          </div>
        </fieldset>
      </div>

      {/* (d) The private field, a distinct inset panel with the §4.11 copy. */}
      <div
        data-testid="private-panel"
        className="rounded-2xl border-2 border-dashed border-cobalt-300 bg-cobalt-50/40 p-6 shadow-sm"
      >
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cobalt-100 text-cobalt-700">
            <LockGlyph />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold text-neutral-900">
              {PRIVATE_PANEL_HEADING}
            </p>
            <p className="text-sm leading-relaxed text-neutral-700">{PRIVATE_PANEL_BODY}</p>
          </div>
        </div>
        <label
          htmlFor="q14-private"
          className="mt-5 block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          {PRIVATE_PANEL_PROMPT}
        </label>
        <textarea
          id="q14-private"
          rows={3}
          value={draft.privateNote}
          onChange={(e) => report({ ...draft, privateNote: e.target.value })}
          className="w-full rounded-xl border border-neutral-300 bg-white p-3.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
        />
        <p className="mt-2 text-xs font-medium text-neutral-500">
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
      className="h-5 w-5"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}