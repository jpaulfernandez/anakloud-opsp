import { type LongTextValue } from "./questions";

// Pure long-text helpers (F03-T02, ui_ux.md §4.4). No I/O, no network — the
// counter and "answered" decisions are deterministic so they can be unit-tested
// without a browser, and so the shell's forward-navigation rule stays pure.

/** The minimum Q1 answer length, the only long-text question with a minimum. */
export const Q1_MIN_CHARS = 200;

/**
 * The counter label for a minimum-length field. Counts *up to* the minimum
 * rather than down from a maximum, so it reads as encouragement, not a limit:
 * "142 of 200", never "58 remaining".
 */
export function charCountLabel(count: number, minimum: number): string {
  return `${count} of ${minimum}`;
}

/**
 * Whether a long-text answer holds content. A long-text question is
 * "answered" when it has any trimmed text — whitespace alone does not count.
 * Q13's cause is intentionally not part of this: the long text on Q13 is what
 * a required answer means (baseline Part A), and picking a cause without
 * writing anything is not an answer.
 */
export function longTextIsAnswered(value: LongTextValue): boolean {
  return value.text.trim().length > 0;
}