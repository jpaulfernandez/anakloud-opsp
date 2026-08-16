import { type MetricTripleValue } from "./questions";

// Pure metric-triple helpers (F03-T04, ui_ux.md §4.6, tech_infrastructure.md
// §3.1). No I/O, no network — the normalisation and "answered" decisions are
// deterministic so they can be unit-tested without a browser, and so the
// shell's forward-navigation rule stays pure (the same discipline as the
// long-text and sentence-completion helpers).
//
// Q3 asks for "the one number that would prove it worked": a metric name, a
// number, a unit, and a one-line why. §3.1 stores it as `{ metric, value,
// unit, why }` with `value` a plain number, so the component keeps the number
// as the respondent typed it (thousands separators included) and this module
// normalises it ("1,500" → 1500) before it is stored. That is the whole reason
// the number is free text here: accepting digits with separators and storing a
// normalised value (F03-T04 acceptance) instead of shipping the literal string.

/** The metric triple in the session while the respondent is still typing.
    `value` is the normalised number, or null until the field holds digits —
    the stored shape requires a number, so a draft carries null until one
    exists. This is what lets an empty number field stay "unanswered" rather
    than being read back as the value 0. */
export interface MetricTripleDraft {
  metric: string;
  value: number | null;
  unit: string;
  why: string;
}

/**
 * Normalise a thousands-separated raw value like "1,500" to the number 1500.
 * Returns null when the field holds nothing or text that cannot be read as a
 * number, so an empty number field does not masquerade as the value 0.
 */
export function parseMetricValue(raw: string): number | null {
  const stripped = raw.replace(/,/g, "").trim();
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a metric-triple draft counts as an answer (Q3 is required, F03-T04).
 * All four parts must hold content — metric name, a parseable number, the
 * unit, and the why — so "1,500" plus metric and unit and a reason reads as
 * one complete statement (ui_ux §4.6) rather than a metric with no value.
 */
export function metricTripleIsAnswered(draft: MetricTripleDraft): boolean {
  return (
    draft.metric.trim() !== "" &&
    draft.value !== null &&
    draft.unit.trim() !== "" &&
    draft.why.trim() !== ""
  );
}

/**
 * The stored §3.1 shape for a draft once it holds a number. Used by the F04
 * persistence ticket later; here it documents that a filled draft is exactly
 * the `{ metric, value, unit, why }` the registry types Q3 with.
 */
export function toMetricTripleValue(draft: MetricTripleDraft): MetricTripleValue {
  return {
    metric: draft.metric,
    value: draft.value ?? 0,
    unit: draft.unit,
    why: draft.why,
  };
}