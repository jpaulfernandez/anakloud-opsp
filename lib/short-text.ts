import {
  CAPPED_SHORT_TEXT_QUESTION_IDS,
  type CappedShortTextQuestionId,
  type CappedShortTextValue,
} from "./questions";

// Pure capped short-text helpers (F03-T10, anakloud-baseline-questions.md Q4,
// Q7, Q12). No I/O, no network — the per-question cap, the clamp, and the
// "answered" rule are deterministic so they can be unit-tested without a
// browser and so the shell's forward-navigation decision stays pure (the same
// discipline as the other F03 libs).
//
// Q4 (ten years, one sentence), Q7 (one promise, one line) and Q12 (name the
// quarter) are short text with hard character caps of 140, 120 and 40
// respectively. The cap is doing real work (ui_ux / baseline): it forces the
// choice between "we do many things" and "we do this one thing". The cap is
// enforced *at input* — the component clamps the field as the respondent
// types via the library's `clampToCap`, not only at a later validation pass —
// and a visible live character counter sits beside the field so the limit is
// never a surprise.

/**
 * The hard character cap for each capped short-text question, verbatim from
 * the baseline (Q4: 140, Q7: 120, Q12: 40). The component reads its cap from
 * here so the registry stays the single source of truth and a component can
 * never be mounted with a cap that contradicts the question.
 */
export const SHORT_TEXT_CAPS: Record<CappedShortTextQuestionId, number> = {
  q4: 140,
  q7: 120,
  q12: 40,
};

/**
 * Clamp text to a hard cap, truncating everything after the cap's characters.
 * This is what enforces the cap at input rather than only at validation: a
 * field driven through this never lets the respondent type past the limit, so
 * an over-long value can never reach the stored shape.
 */
export function clampToCap(text: string, cap: number): string {
  return text.slice(0, cap);
}

/**
 * The live counter label for a capped field. Counts *up to* the cap in the
 * same voice as the Q1 minimum counter ("142 of 200"), so it reads as the
 * field's own known limit rather than a warning of something about to break —
 * "32 of 140", never "108 remaining".
 */
export function shortTextCounterLabel(count: number, cap: number): string {
  return `${count} of ${cap}`;
}

/**
 * Whether a capped short-text answer holds content. A capped question is
 * "answered" when the line carries any trimmed text — whitespace alone does
 * not count. (Q4, Q7 and Q12 are all required in the registry.)
 */
export function shortTextIsAnswered(value: CappedShortTextValue): boolean {
  return value.text.trim().length > 0;
}

/**
 * The three capped ids in registry order, so a component and its tests key on
 * the same array the registry uses and a future question can't drift from it.
 */
export const CAPPED_SHORT_TEXT_ID_LIST: readonly CappedShortTextQuestionId[] =
  CAPPED_SHORT_TEXT_QUESTION_IDS;