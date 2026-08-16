"use client";

import {
  Q10_MODEL_ID_LIST,
  Q10_PAYER_ID_LIST,
  type Q10Draft,
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
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400";

const radioClass =
  "flex flex-wrap items-center gap-x-5 gap-y-2 text-base text-neutral-800";

export function Q10Input({
  value,
  onChange,
}: {
  /** Existing draft to seed the parts (empty until persistence exists). */
  value?: Q10Draft;
  onChange: (value: Q10Draft) => void;
}) {
  const draft: Q10Draft = {
    payer: value?.payer ?? null,
    model: value?.model ?? null,
    amount: value?.amount ?? "",
    firstPeso: value?.firstPeso ?? "",
  };
  const unit = draft.model === null ? "" : modelUnitLabel(draft.model);

  return (
    <div className="flex flex-col gap-6" data-testid="q10-four-parts">
      <fieldset data-testid="q10-payer">
        <legend className="text-base font-medium text-neutral-700">
          Who physically pays us?
        </legend>
        <div className={`${radioClass} mt-2`}>
          {Q10_PAYER_ID_LIST.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="q10-payer"
                value={option}
                checked={draft.payer === option}
                onChange={() => onChange({ ...draft, payer: option })}
                className="mr-1.5 h-4 w-4"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset data-testid="q10-model">
        <legend className="text-base font-medium text-neutral-700">
          What&rsquo;s the model?
        </legend>
        <div className={`${radioClass} mt-2`}>
          {Q10_MODEL_ID_LIST.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="q10-model"
                value={option}
                checked={draft.model === option}
                onChange={() => onChange({ ...draft, model: option })}
                className="mr-1.5 h-4 w-4"
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>

      <div data-testid="q10-amount">
        <label
          htmlFor="q10-amount-field"
          className="block text-base font-medium text-neutral-700"
        >
          What do they pay, in pesos?
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="q10-amount-field"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.amount}
            onChange={(e) =>
              onChange({ ...draft, amount: e.target.value })
            }
            className={`${fieldClass} w-40`}
          />
          {unit !== "" && (
            <span className="text-base text-neutral-600">pesos · {unit}</span>
          )}
        </div>
      </div>

      <div data-testid="q10-first-peso">
        <label
          htmlFor="q10-first-peso-field"
          className="block text-base font-medium text-neutral-700"
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
          className={`${fieldClass} mt-1 w-48`}
        />
        <p className="mt-1.5 text-sm text-neutral-500">
          Not a grant or a competition prize — a customer paying for the
          product.
        </p>
      </div>
    </div>
  );
}