import type { Q6Choice, Q6Value } from "./questions";

// Pure single-choice + required-reason helpers (F03-T06, ui_ux.md §4.9,
// anakloud-baseline-questions.md Q6). No I/O, no network — the option labels,
// the "answered" rule and the blocked message are deterministic so they can be
// unit-tested without a browser and so the shell's forward-navigation decision
// stays pure (the same discipline as the metric-triple helpers).
//
// Q6 is the tiebreak: "The therapy center wants one thing. The parent wants
// the opposite. We can only serve one. Whose side do we take?" The §3.1 stored
// shape is `{ choice, why }` — one of four parties (center / parent /
// pediatrician / therapist) plus a required one-line reason. A bare choice
// with no reason is not an answer, so unlike the single-choice buttons alone,
// "answered" requires both halves. And because the reason is the required
// half, a blocked Continue on Q6 explains itself with the specific line the
// spec names rather than the shell's generic "Answer this before moving on."
// (ui_ux §4.9) — the button stays live and says its piece in words.

/**
 * Q6 while the respondent is still working. `choice` is null until one of the
 * four parties is selected, so an unstarted question reads as unanswered
 * rather than silently defaulting to one of the four sides — the same reason
 * the metric triple keeps an empty number as null, not 0.
 */
export interface SingleChoiceReasonDraft {
  choice: Q6Choice | null;
  why: string;
}

/**
 * The display label for each of the four Q6 parties, verbatim from
 * anakloud-baseline-questions.md Q6 ("center / parent / pediatrician /
 * therapist"). These are the radio option labels.
 */
export const Q6_CHOICE_LABELS: Record<Q6Choice, string> = {
  center: "Center",
  parent: "Parent",
  pedia: "Pediatrician",
  therapist: "Therapist",
};

/**
 * The explanatory line a blocked Continue on Q6 must render — the reason is
 * the required half, so when the answer is incomplete this is what the screen
 * says instead of the generic unanswered message (ui_ux §4.9, F03-T06).
 */
export const SINGLE_CHOICE_REASON_BLOCKED_MESSAGE = "Add a line about why";

/**
 * Whether a single-choice-reason draft counts as an answer (Q6 is required,
 * F03-T06). Both halves must be present: a party selected and a non-blank
 * reason. A bare choice with no reason is a short answer to the sharpest
 * question in the set, so it is not allowed to pass silently (baseline Q6:
 * "do not let them submit a bare choice").
 */
export function singleChoiceReasonIsAnswered(
  value: SingleChoiceReasonDraft,
): boolean {
  return value.choice !== null && value.why.trim() !== "";
}

/**
 * The stored §3.1 shape once the draft holds a choice. The caller guarantees a
 * choice exists (an answered draft has `choice !== null`), so this maps the
 * two-part draft onto the `{ choice, why }` the registry types Q6 with.
 */
export function toSingleChoiceReasonValue(
  draft: SingleChoiceReasonDraft,
): Q6Value {
  if (draft.choice === null) {
    throw new Error("cannot map an unanswered single-choice draft to a value");
  }
  return { choice: draft.choice, why: draft.why };
}