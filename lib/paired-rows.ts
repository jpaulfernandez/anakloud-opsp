import type {
  Q11Value,
  PairedRowsQuestionId,
  QuestionAnswerValues,
} from "./questions";

// Pure paired-rows + star helpers (F03-T08, ui_ux.md §4.10,
// anakloud-baseline-questions.md Q11). No I/O, no network — the block count,
// the star note and the "answered" rule are deterministic so they can be
// unit-tested without a browser and so the shell's forward-navigation decision
// stays pure (the same discipline as the other F03 libs).
//
// Q11 is "what must be done by year-end": up to three repeating blocks, each a
// "What" plus a "Done when" (a number, a date, or something you could point
// at). One star is a radio across all three blocks marking the single most
// important one — the #1 priority (baseline Q11, OPSP → The #1 Critical
// Number). The stored §3.1 shape is `{ rocks, starred }`: the three
// what/done-when pairs plus the index of the starred one.
//
// The star is a radio, not a checkbox (ui_ux §4.10): selecting a second star
// clears the first by construction. When that happens the screen explains
// itself with an inline note, and that note is *reason* microcopy, never a
// validation error — the star is optional, so there is nothing to have failed.
// Only the first block is required; blocks two and three are optional, which
// quietly discourages padding to three (ui_ux §4.10).

/** A full typed Q11 rock, from the §3.1 stored shape reuse for the draft. */
type RockDraft = QuestionAnswerValues[PairedRowsQuestionId]["rocks"][number];

/**
 * Q11 while the respondent is still working. The three blocks are a fixed
 * tuple (the question always renders three rows), each with a blankable
 * "What"/"Done when". `starred` is null until one of the three is picked, so
 * an unstarred question reads honestly as having no #1 yet — never silently
 * defaulting to the first block (that would be an anchor).
 */
export interface PairedRowsDraft {
  rocks: [RockDraft, RockDraft, RockDraft];
  /** Index of the starred block, or null until a star is picked. */
  starred: 0 | 1 | 2 | null;
}

/** An empty, unstarted Q11 draft (all three blocks blank, no star). */
export function emptyPairedRowsDraft(): PairedRowsDraft {
  return {
    rocks: [
      { what: "", done_when: "" },
      { what: "", done_when: "" },
      { what: "", done_when: "" },
    ],
    starred: null,
  };
}

/**
 * The inline note shown when a star replaces a previously selected one
 * (ui_ux §4.10: "Only one can be the most important — that's the point."). It
 * reads as a *reason*, not as a rule or a validation error, so it is a plain
 * statement, not an error-labelled message.
 */
export const PAIRED_ROWS_STAR_NOTE =
  "Only one can be the most important — that's the point.";

/**
 * Whether a paired-rows draft counts as an answer (Q11 is required, F03-T08).
 * Only the first block must hold both a "What" and a "Done when"; blocks two
 * and three are optional, and the star is not required to pass — so a single
 * well-formed rock is enough to advance ("Completing only block one passes the
 * required check"). The done-condition matters as much as the what: a blank
 * "Done when" on the first block leaves the rock unverifiable, which is the
 * whole thing the question exists to catch.
 */
export function pairedRowsIsAnswered(value: PairedRowsDraft): boolean {
  return (
    value.rocks[0].what.trim() !== "" &&
    value.rocks[0].done_when.trim() !== ""
  );
}

/**
 * The stored §3.1 shape once the draft holds a star. The registry types Q11's
 * starred field as `0 | 1 | 2`, so mapping an unstarred draft — one that
 * passes the required check but has no #1 — has nowhere to put that absence
 * and is refused. This mirrors the other libs' "cannot map what is not there"
 * guard; the star is decided at persist time (baseline Q11: "If you can't
 * pick, you haven't finished the session").
 */
export function toPairedRowsValue(draft: PairedRowsDraft): Q11Value {
  if (draft.starred === null) {
    throw new Error("cannot map an unstarred paired-rows draft to a value");
  }
  return { rocks: draft.rocks, starred: draft.starred };
}