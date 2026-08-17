"use client";

import {
  CONFIDENCE_LABEL,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  clampConfidence,
} from "@/lib/confidence";

// Confidence slider (F03-T11, FR-11, ui_ux.md §4.3, §7).
//
// A 1–5 confidence slider paired with a numeric input reflecting the same
// value — ui_ux §7 pairs every slider with a numeric input, and the two draft
// the shared screen you see as "Confidence  1 ─○─────── 5" (§4.3). The slider
// starts **unset**: no default position exists, because a default would anchor
// every respondent to a middle ring the same way a default hours value or a
// fixed ranking order would. Until a value is set the range thumb is hidden
// (the `.confidence[data-set="false"]` rule) and the numeric field is blank,
// so the unset state reads honestly as unanswered rather than hiding behind a
// suggested 3.
//
// The two controls write the same value, so editing either moves the other, and
// the numeric input is clamped to the 1..5 range so it can't drift the slider
// off the scale. The stored value is a plain 1..5 number (or null while unset);
// it lives on the question's answer as the `answers.confidence` column, written
// by the F04 persistence ticket. The shell owns the "required before
// continuing" rule — this component only collects the value.

function setValue(
  raw: string,
  onChange: (value: number | null) => void,
): void {
  if (raw === "") {
    onChange(null);
    return;
  }
  const n = Number(raw);
  if (Number.isNaN(n)) return;
  onChange(clampConfidence(n));
}

export function ConfidenceSlider({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const sliderId = "confidence-slider";
  const numberId = "confidence-number";
  return (
    <div
      className="confidence flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200/80 bg-white p-4 shadow-card"
      data-set={value !== null}
    >
      <span className="text-sm font-bold text-neutral-800">
        {CONFIDENCE_LABEL}
      </span>
      <span className="text-xs font-semibold tabular-nums text-neutral-400">
        {CONFIDENCE_MIN}
      </span>
      <input
        id={sliderId}
        type="range"
        min={CONFIDENCE_MIN}
        max={CONFIDENCE_MAX}
        step={1}
        value={value !== null ? value : CONFIDENCE_MIN}
        aria-label={CONFIDENCE_LABEL}
        aria-valuetext={value !== null ? `${value} of 5` : "unset"}
        onChange={(e) => onChange(clampConfidence(Number(e.target.value)))}
        className="min-w-28 flex-1"
      />
      <span className="text-xs font-semibold tabular-nums text-neutral-400">
        {CONFIDENCE_MAX}
      </span>
      <label htmlFor={numberId} className="sr-only">
        Confidence (number)
      </label>
      <input
        id={numberId}
        type="number"
        min={CONFIDENCE_MIN}
        max={CONFIDENCE_MAX}
        value={value !== null ? value : ""}
        onChange={(e) => setValue(e.target.value, onChange)}
        className="h-11 w-14 rounded-xl border border-neutral-300 bg-white px-2 py-1 text-center font-semibold tabular-nums text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
      />
    </div>
  );
}