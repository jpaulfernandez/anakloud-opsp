"use client";

import {
  Q10_MODEL_ID_LIST,
  Q10_PAYER_ID_LIST,
  type Q10Draft,
  type Q10PayerOption,
  modelUnitLabel,
} from "@/lib/q10";

// Four-part money input for Q10 (F03-T10, anakloud-baseline-questions.md Q10).
// Renders all four parts of "how the money works": (a) who pays, a single
// choice; (b) the model, a single choice; (c) what they pay, a peso amount; and
// (d) the month the first real peso arrives, a native-friendly month-year
// picker that produces YYYY-MM and works at 360px.
//
// The unit on (c) is derived from the model chosen in (b) via modelUnitLabel —
// it is the one place a suggested unit is allowed, and only because it restates
// what the respondent already said. "not sure yet" on (b) is a complete, valid
// answer, so nothing here demands a peso amount or a month from someone who
// hasn't settled the model.
//
// No placeholder text on any field — a placeholder would anchor the answer. The
// radio groups carry no selected value until the respondent taps one (a default
// is an anchor), and the shell's navigation gate decides "answered", never this
// component blocking or deciding navigation itself (PR4, D2).

const fieldClass =
  "min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20";

const radioLabelClass =
  "inline-flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-800 transition-all hover:border-cobalt-300 hover:bg-cobalt-50/20 has-checked:border-cobalt-600 has-checked:bg-cobalt-50/50 has-checked:text-cobalt-950 shadow-subtle";

export function Q10Input({
  value,
  onChange,
}: {
  /** Existing draft to seed the parts (empty until persistence exists). */
  value?: Q10Draft;
  onChange: (value: Q10Draft) => void;
}) {
  const currentPayers: Q10PayerOption[] = Array.isArray(value?.payer)
    ? value.payer
    : value?.payer
      ? [value.payer as Q10PayerOption]
      : [];

  const draft: Q10Draft = {
    payer: currentPayers,
    model: value?.model ?? null,
    amount: value?.amount ?? "",
    firstPeso: value?.firstPeso ?? "",
  };
  const unit = draft.model === null ? "" : modelUnitLabel(draft.model);

  const togglePayer = (option: Q10PayerOption) => {
    const nextPayers = currentPayers.includes(option)
      ? currentPayers.filter((p) => p !== option)
      : [...currentPayers, option];
    onChange({ ...draft, payer: nextPayers });
  };

  return (
    <div className="flex flex-col gap-6" data-testid="q10-four-parts">
      <fieldset data-testid="q10-payer" className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <legend className="text-base font-bold text-neutral-900 mb-3">
          Who physically pays us?
        </legend>
        <div className="flex flex-wrap gap-2.5">
          {Q10_PAYER_ID_LIST.map((option) => (
            <label key={option} className={radioLabelClass}>
              <input
                type="checkbox"
                name="q10-payer"
                value={option}
                checked={currentPayers.includes(option)}
                onChange={() => togglePayer(option)}
                className="h-4 w-4 rounded text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
              />
              <span className="font-semibold">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset data-testid="q10-model" className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <legend className="text-base font-bold text-neutral-900 mb-3">
          What&rsquo;s the model?
        </legend>
        <div className="flex flex-wrap gap-2.5">
          {Q10_MODEL_ID_LIST.map((option) => (
            <label key={option} className={radioLabelClass}>
              <input
                type="radio"
                name="q10-model"
                value={option}
                checked={draft.model === option}
                onChange={() => onChange({ ...draft, model: option })}
                className="h-4 w-4 text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
              />
              <span className="font-semibold">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div data-testid="q10-amount" className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <label
          htmlFor="q10-amount-field"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          What do they pay, in pesos?
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id="q10-amount-field"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.amount}
            onChange={(e) =>
              onChange({ ...draft, amount: e.target.value })
            }
            className={`${fieldClass} w-48`}
          />
          {unit !== "" && (
            <span className="text-sm font-semibold text-neutral-600 bg-neutral-100 px-3 py-2 rounded-xl">
              pesos · {unit}
            </span>
          )}
        </div>
      </div>

      <div data-testid="q10-first-peso" className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6">
        <label
          htmlFor="q10-first-peso-field"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          What month does the first real peso arrive?
        </label>
        <input
          id="q10-first-peso-field"
          type="month"
          autoComplete="off"
          data-testid="q10-month-picker"
          value={draft.firstPeso}
          onChange={(e) => onChange({ ...draft, firstPeso: e.target.value })}
          className={`${fieldClass} w-56`}
        />
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          Not a grant or a competition prize — a customer paying for the
          product.
        </p>
      </div>
    </div>
  );
}