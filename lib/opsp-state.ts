// The ink/pencil and empty-cell treatment (F07-T03, FR-24, ui_ux.md §2, §4.14,
// §7). Pure, no I/O, no network: resolving a cell's rendered state (ink,
// pencil, empty) and its note from the mapping's output (lib/opsp.ts) is
// deterministic and unit-testable without a browser, the same discipline as
// the mapping and the base view helpers (lib/opsp-view.ts).
//
// PR1/FR-24 keep this honest: a pencil cell is a pre-beta guess or a low-
// confidence answer, and an empty cell is a real blank — nothing here invents
// content to fill one (ui_ux.md §4.14: "Nothing is invented to fill a hole").
// The ink/pencil signal travels as weight, a dashed left border and a text
// "revisit" tag, never as colour, so it survives printing to black and white
// (§2, §7). The *state* is resolved here; the CSS classes that realise it live
// in the view component.

import type { OpspCell } from "./opsp";

/** The rendered state of an OPSP cell, resolved from marking and value. */
export type OpspCellState =
  | { kind: "empty" }
  | { kind: "ink" }
  | { kind: "pencil"; lowConfidence: boolean };

/** The short text tag every pencil cell carries (ui_ux.md §2). */
export const OPSP_REVISIT_TAG = "revisit";

/** Note for a cell whose source answer was blank (ui_ux.md §4.14). */
export const OPSP_EMPTY_NOTE =
  "You didn't answer this — that's fine, leave it blank.";

/** Note for a pencil cell whose cause is a low-confidence answer (§4.14). */
export const OPSP_LOW_CONFIDENCE_NOTE =
  "You marked low confidence here — worth revisiting after beta.";

/**
 * Resolve a cell's rendered state. An empty value (null/undefined) is always
 * the empty state — a real blank, never auto-filled. Otherwise a single ink
 * mark is ink; anything with a pencil — a single pencil, or a split 3-Year
 * Targets cell that always carries a pencil part — is pencil, flagged with
 * whether the mapping recorded a low-confidence feeding answer so the note can
 * distinguish "you said you were unsure" from Part B's editorial pencil
 * defaults (BHAG, Brand Promise, Profit per X, 1-Year Critical Number, the
 * 3-Year number).
 */
export function resolveOpspCellState(cell: OpspCell): OpspCellState {
  if (cell.value === null || cell.value === undefined) return { kind: "empty" };
  if (cell.marking.type === "single" && cell.marking.mark === "ink") {
    return { kind: "ink" };
  }
  return { kind: "pencil", lowConfidence: cell.lowConfidence };
}

/** Whether a cell renders the small "revisit" tag. */
export function showsRevisitTag(state: OpspCellState): boolean {
  return state.kind === "pencil";
}

/** The note a cell carries, or null when it carries none. */
export function opspCellNote(state: OpspCellState): string | null {
  if (state.kind === "empty") return OPSP_EMPTY_NOTE;
  if (state.kind === "pencil" && state.lowConfidence) {
    return OPSP_LOW_CONFIDENCE_NOTE;
  }
  return null;
}