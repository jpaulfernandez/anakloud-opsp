// F10-T03 — the comparison screen's pure model (FR-30, ui_ux.md §4.18).
//
// Kept free of I/O and the request, exactly like the validators and the
// divergence scorer (PR3, the same discipline that lets it run with the AI key
// absent): the screen turns a fetched QuestionComparison into the strings and
// verdicts it renders, and those transformations are unit-testable without a
// browser or a database.
//
// The anonymised safety posture is decided here, in the pure layer: the screen
// is anonymised by default (F10-T03 predates the toggle; F10-T04 adds the
// confirmation) and the answer text must not carry respondent identifiers.
// Q14(b) stores *which teammate* each respondent thinks owns which function,
// keyed by respondent id. In anonymised mode those ids are redacted to a
// neutral label, because projecting the comparison is the failure mode the
// anonymised default exists to prevent — the raw identifiers must never reach
// a card that is going onto the wall (ui_ux.md §4.18).

import { formatAnswerSummary } from "./review";
import type { DivergenceCategory } from "./divergence";
import type { QuestionId } from "./questions";

/** The neutral label shown in place of a teammate's name in anonymised mode. */
const ANONYMISED_TEAMMATE_LABEL = "a teammate";

/**
 * The exact wording of the confirmation required to enter attributed mode
 * (F10-T04, ui_ux.md §4.18). Kept here so the component and its test share one
 * string — the requirement is that the dialog reads exactly this, verbatim.
 */
export const ATTRIBUTED_CONFIRM_MESSAGE =
  "This shows names. Don't use this while projecting.";

/**
 * Randomise card order (F10-T04, ui_ux.md §4.18): in anonymised mode position
 * must not be able to infer identity across sessions, so every load draws a
 * fresh permutation. Fisher–Yates over a copy, driven by `random` so the pivot
 * is controllable and the function stays pure and unit-testable — the default
 * source is all a page reload needs for per-load variety.
 */
export function shuffleAnswers<T>(
  answers: readonly T[],
  random: () => number = Math.random,
): T[] {
  const out = [...answers];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The badge text for a divergence verdict, or null when there is none (a
 * closed, non-confidence question reports agreement but is never
 * aligned/soft/hard — FR-31). Empty answers that score nothing also yield
 * null, so the screen shows nothing where there is nothing to say.
 */
export function divergenceBadgeLabel(
  category: DivergenceCategory | "manual review" | null,
): string | null {
  switch (category) {
    case "aligned":
      return "Aligned";
    case "soft split":
      return "Soft split";
    case "hard split":
      return "Hard split";
    case "manual review":
      return "Manual review";
    default:
      return null;
  }
}

/**
 * The full answer text of one comparison card. Delegates to the shared answer
 * formatter; when `anonymise` is set (the default comparison posture) the
 * Q14(b) teammate ids are replaced with a neutral label so no respondent
 * identifier reaches the card. All other questions carry no identity in their
 * value, so redaction is a no-op outside q14.
 */
export function comparisonAnswerText(
  questionId: QuestionId,
  value: unknown,
  anonymise: boolean,
): string {
  return formatAnswerSummary(
    questionId,
    value,
    anonymise ? () => ANONYMISED_TEAMMATE_LABEL : undefined,
  );
}