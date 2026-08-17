"use client";

import { useState } from "react";
import {
  type MetricTripleDraft,
  parseMetricValue,
} from "@/lib/metric-triple";

// Metric-triple input (F03-T04, FR-10, ui_ux.md §4.6) for Q3.
//
// Four labelled fields: metric name, number, unit, and a one-line "why that
// one". The number field accepts digits with thousands separators and the value
// is stored normalised ("1,500" → 1500, tech_infrastructure.md §3.1). `unit` is
// deliberately free text — never a dropdown, combobox, or any control that
// enumerates candidate units, because a unit list would anchor every respondent
// to the same measurement vocabulary (a value list supplies the options, and
// that is exactly the anchoring this question exists to detect). The unit field
// carries `autoComplete="off"` so the browser does not seed its own unit
// suggestions on top of that.
//
// The field relationships are shown visually so metric/number/unit read as one
// statement rather than three unrelated inputs: "How many?" groups the number
// and unit side by side in a shared bordered container, exactly as ui_ux §4.6
// draws them ("1,500 children" is one thought, split across two inputs).
//
// "Answered" is computed by the shell from the emitted draft (all four parts
// filled, a parseable number), so this component never blocks or decides
// navigation itself (PR4, D2).

const fieldClass =
  "w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20";

export function MetricTripleInput({
  value,
  onChange,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: MetricTripleDraft;
  onChange: (value: MetricTripleDraft) => void;
}) {
  // The number is held as the raw string the respondent typed (separators
  // included); the emitted draft normalises it to a number via parseMetricValue.
  const [draft, setDraft] = useState<{
    metric: string;
    rawValue: string;
    unit: string;
    why: string;
  }>(() => ({
    metric: value?.metric ?? "",
    rawValue: value?.value != null ? String(value.value) : "",
    unit: value?.unit ?? "",
    why: value?.why ?? "",
  }));

  function setField(
    field: "metric" | "rawValue" | "unit" | "why",
    next: string,
  ) {
    setDraft((current) => {
      const updated = { ...current, [field]: next };
      onChange({
        metric: updated.metric,
        value: parseMetricValue(updated.rawValue),
        unit: updated.unit,
        why: updated.why,
      });
      return updated;
    });
  }

  return (
    <div className="flex flex-col gap-6" data-testid="metric-triple">
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card">
        <label
          htmlFor="q3-metric"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          What would you count?
        </label>
        <input
          id="q3-metric"
          type="text"
          value={draft.metric}
          onChange={(e) => setField("metric", e.target.value)}
          className={fieldClass}
          autoComplete="off"
        />
      </div>

      <fieldset
        data-testid="q3-number-unit"
        className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card"
      >
        <legend className="px-1 text-sm font-bold uppercase tracking-wider text-neutral-600">
          How many?
        </legend>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="sm:w-1/3">
            <label
              htmlFor="q3-value"
              className="block text-xs font-semibold text-neutral-500 mb-1"
            >
              Number
            </label>
            <input
              id="q3-value"
              type="text"
              inputMode="numeric"
              value={draft.rawValue}
              onChange={(e) => setField("rawValue", e.target.value)}
              className={fieldClass}
              autoComplete="off"
            />
          </div>
          <div className="flex-1">
            <label
              htmlFor="q3-unit"
              className="block text-xs font-semibold text-neutral-500 mb-1"
            >
              Unit
            </label>
            {/* plain free-text field with autofill off — NOT a datalist / select,
                and no `list` attribute, so no candidate units are ever suggested */}
            <input
              id="q3-unit"
              type="text"
              value={draft.unit}
              onChange={(e) => setField("unit", e.target.value)}
              className={fieldClass}
              autoComplete="off"
            />
          </div>
        </div>
      </fieldset>

      <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card">
        <label
          htmlFor="q3-why"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          Why that one?
        </label>
        <input
          id="q3-why"
          type="text"
          value={draft.why}
          onChange={(e) => setField("why", e.target.value)}
          className={fieldClass}
          autoComplete="off"
        />
      </div>
    </div>
  );
}