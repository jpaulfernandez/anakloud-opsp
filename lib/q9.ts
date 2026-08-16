import { type Q9ValueType } from "./questions";

// Pure Q9 helpers (F03-T10, anakloud-baseline-questions.md Q9). No I/O, no
// network — the labels and the "answered" rule are deterministic so they can be
// unit-tested without a browser and so the shell's forward-navigation decision
// stays pure (the same discipline as the other F03 libs).
//
// Q9 is "what we are deliberately not doing": three things Anakloud will not do
// in the next two years, even though they're tempting. Baseline marks all three
// fields required, and strategy is mostly a list of refusals — so the dirty
// length-1 answer "no." won't carry the question. The §3.1 stored shape is a
// three-item tuple `{ items: [string, string, string] }`.

/**
 * The display label for the Nth refusal field, written as the "not doing" the
 * baseline asks for, numbered so all three are distinct and individually
 * reachable by label (a component never renders two anonymous boxes).
 * 1-indexed: "Not doing 1", "Not doing 2", "Not doing 3".
 */
export function q9FieldLabel(index: 1 | 2 | 3): string {
  return `Not doing ${index}`;
}

/**
 * Whether a Q9 draft counts as an answer (Q9 is required, F03-T10). All three
 * fields must carry trimmed text — three separate lines, all required — so a
 * partial set of refusals is not an answer (baseline Q9: "Name three things").
 */
export function q9IsAnswered(value: Q9ValueType): boolean {
  return value.items.every((item) => item.trim().length > 0);
}