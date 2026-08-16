import type { QuestionId } from "./questions";

// Pure confidence helpers (F03-T11, FR-11, ui_ux.md §4.3, §7,
// tech_infrastructure.md §3.1). No I/O, no network — the range, the set of
// questions that carry a slider, and the "is it set" decision are deterministic
// so they can be unit-tested without a browser, and so the shell's forward-
// navigation rule stays pure (the same discipline as the other F03 libs).
//
// FR-11: confidence sliders appear on Q3, Q4, Q7, Q8, Q10, Q11 only, and they
// are required. The slider starts **unset** — a default position (say, 3) would
// anchor every respondent to a middle confidence the same way a default hours
// value or a fixed ranking order would (PR1). The stored value lives on the
// question's answer as the `answers.confidence` column (§3.1 puts the 1..5 in
// its own smallint column, not inside the question's `value` jsonb), so it is
// held here as a plain 1..5 number or null while unset, ready for the F04
// persistence ticket to write.

/** The lower bound of the confidence scale (ui_ux §4.3 renders "1 ─○─── 5"). */
export const CONFIDENCE_MIN = 1;
/** The upper bound of the confidence scale. */
export const CONFIDENCE_MAX = 5;

/**
 * The six questions carrying a required confidence slider (FR-11). Asserted
 * against the registry in tests so the component and the persisted column can
 * never drift from the requirement.
 */
export const CONFIDENCE_QUESTION_IDS = [
  "q3", "q4", "q7", "q8", "q10", "q11",
] as const;
export type ConfidenceQuestionId = (typeof CONFIDENCE_QUESTION_IDS)[number];

/** A type guard so the F03 shell can narrow a QuestionId before mounting the
    ConfidenceSlider — the same pattern as the other input guards above. */
export function isConfidenceQuestion(
  id: QuestionId,
): id is ConfidenceQuestionId {
  return (CONFIDENCE_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/** The visible label for the paired slider + numeric input (ui_ux §4.3). */
export const CONFIDENCE_LABEL = "Confidence";

/**
 * The line shown when a respondent tries to continue from one of the six
 * confidence questions without having set a value. It explains what is missing
 * rather than greying out the button (F03-T01), the same way Q6's required
 * reason has its own words.
 */
export const CONFIDENCE_REQUIRED_MESSAGE =
  "Let us know how confident you are, from 1 to 5, before moving on.";

/**
 * Clamp a raw number (from the paired numeric input) onto the 1..5 range the
 * slider can hold. Rounded so a typed "3.7" becomes a whole slider stop rather
 * than a value the range cannot represent.
 */
export function clampConfidence(n: number): number {
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Math.round(n)));
}

/**
 * Whether a confidence value counts as set. `null` (or an out-of-range value)
 * is unset, because the slider starts blank and a blanket "0" or "6" would not
 * be a real ring on the 1..5 scale.
 */
export function confidenceIsSet(value: number | null): boolean {
  return value !== null && value >= CONFIDENCE_MIN && value <= CONFIDENCE_MAX;
}