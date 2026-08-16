import { type Q2Value } from "./questions";

// Pure sentence-completion helpers (F03-T03, ui_ux.md §4.5). No I/O, no
// network — the two sentence fragments and the "answered" rule are deterministic
// so they can be unit-tested without a browser, and so the shell's
// forward-navigation decision stays pure.
//
// Q2 is one sentence ("The people who would miss it most are ______, because
// ______.") with two inline blanks (ui_ux.md §4.5). The fragments are written
// verbatim from the sentence so a field can carry its fragment as a label —
// the sentence structure is doing the cognitive work, and it must survive on
// every viewport and in the screen-reader tree (never two anonymous boxes).

/** The sentence fragment labelling the first blank ("who"). */
export const Q2_WHO_LABEL = "The people who would miss it most are";
/** The sentence fragment labelling the second blank ("because"). */
export const Q2_BECAUSE_LABEL = "because";

/**
 * Whether a sentence-completion answer holds content. A complete sentence has
 * both blanks filled, so an answer counts only when both sides carry trimmed
 * text — whitespace alone does not count. This is what the shell's "answered"
 * set keys on: Q2 is required, and a sentence with an empty half is not an
 * answer.
 */
export function sentenceCompletionIsAnswered(value: Q2Value): boolean {
  return value.who.trim().length > 0 && value.because.trim().length > 0;
}