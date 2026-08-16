import { describe, expect, it } from "vitest";
import {
  buildOpspCells,
  OPSP_CELL_IDS,
  type OpspSourceAnswers,
} from "../../lib/opsp";
import { formatOpspCellValue } from "../../lib/opsp-view";
import {
  OPSP_EMPTY_NOTE,
  OPSP_LOW_CONFIDENCE_NOTE,
  OPSP_REVISIT_TAG,
  opspCellNote,
  resolveOpspCellState,
  showsRevisitTag,
  type OpspCellState,
} from "../../lib/opsp-state";
import { SEED_RESPONDENTS, type SeedAnswer } from "../../lib/seed";

// F07-T03 — ink, pencil and empty cells (FR-24, ui_ux.md §2, §4.14, §7). Pure
// decisions, no browser: resolving a cell's rendered state (ink / pencil /
// empty) and its note from the mapping's output. The three acceptance criteria
// map straight onto these tests — the ink/pencil distinction is carried as
// weight/border/tag (so greyscale cannot erase it), low-confidence and empty
// cells carry their respective notes, and no cell ever renders text that does
// not trace to the respondent's answers.
//
// A pencil reason matters: a low-confidence answer gets the "worth revisiting"
// note, while Part B's editorial pencil defaults (BHAG, Brand Promise, Profit
// per X, 1-Year Critical Number) at full confidence carry only the "revisit"
// tag — the mapping records lowConfidence (lib/opsp.ts) so the two are never
// conflated.

/** Build the mapping's snapshot from a §3.1 seed answer list. */
function snapshotFrom(answers: ReadonlyArray<SeedAnswer>): OpspSourceAnswers {
  const snapshot: OpspSourceAnswers = {};
  for (const a of answers) {
    snapshot[a.question_id] = { value: a.value, confidence: a.confidence ?? null };
  }
  return snapshot;
}

/** A convenience snapshot builder for hand-written scattering tests. */
function snapshot(
  answers: Record<string, { value: unknown; confidence?: number | null }>,
): OpspSourceAnswers {
  const out: OpspSourceAnswers = {};
  for (const [q, a] of Object.entries(answers)) {
    out[q] = { value: a.value, confidence: a.confidence ?? null };
  }
  return out;
}

describe("F07-T03 OPSP ink / pencil / empty treatment", () => {
  it("renders a confident, complete cell as ink with no tag and no note", () => {
    const cells = buildOpspCells(
      snapshot({ q12: { value: { text: "Make the referral loop real" } } }),
    );
    const state = resolveOpspCellState(cells.quarterly_theme);
    expect(state).toEqual({ kind: "ink" });
    expect(showsRevisitTag(state)).toBe(false);
    expect(opspCellNote(state)).toBeNull();
  });

  it("renders an empty cell with the empty note, no tag, and empty content", () => {
    const cells = buildOpspCells(snapshot({}));
    const state = resolveOpspCellState(cells.core_values);
    expect(state).toEqual({ kind: "empty" });
    expect(showsRevisitTag(state)).toBe(false);
    expect(opspCellNote(state)).toBe(OPSP_EMPTY_NOTE);
    // The blank stays blank — nothing is invented to fill the hole.
    expect(formatOpspCellValue(cells.core_values.value)).toBe("");
  });

  it("bumps an ink-default cell to pencil on low confidence and shows the note", () => {
    const cells = buildOpspCells(
      snapshot({
        q11: {
          value: { rocks: [{ what: "Onboard beta centers", done_when: "8 centers" }], starred: 0 },
          confidence: 1,
        },
      }),
    );
    const state = resolveOpspCellState(cells.quarterly_rocks);
    expect(state).toEqual({ kind: "pencil", lowConfidence: true });
    expect(showsRevisitTag(state)).toBe(true);
    expect(opspCellNote(state)).toBe(OPSP_LOW_CONFIDENCE_NOTE);
  });

  it("keeps a full-confidence Part B pencil cell pencil, tagged but with no low-confidence note", () => {
    // BHAG is pencil by editorial default; at high confidence the respondent
    // did not mark low confidence, so it carries the revisit tag but not the
    // note. The note must not be conflated with the default.
    const cells = buildOpspCells(
      snapshot({
        q4: { value: { text: "Every child identified by five." }, confidence: 5 },
      }),
    );
    const state = resolveOpspCellState(cells.bhag);
    expect(state).toEqual({ kind: "pencil", lowConfidence: false });
    expect(showsRevisitTag(state)).toBe(true);
    expect(opspCellNote(state)).toBeNull();
  });

  it("treats the split 3-Year Targets cell as pencil, noting it only when Q3 is low-confidence", () => {
    const confident = buildOpspCells(
      snapshot({
        q3: { value: { metric: "paying centers", value: 300, unit: "centers", why: "adoption" }, confidence: 4 },
      }),
    );
    const cState = resolveOpspCellState(confident.three_year_targets);
    expect(cState).toEqual({ kind: "pencil", lowConfidence: false });
    expect(showsRevisitTag(cState)).toBe(true);
    expect(opspCellNote(cState)).toBeNull();

    const low = buildOpspCells(
      snapshot({
        q3: { value: { metric: "paying centers", value: 300, unit: "centers", why: "adoption" }, confidence: 1 },
      }),
    );
    const lState = resolveOpspCellState(low.three_year_targets);
    expect(lState).toEqual({ kind: "pencil", lowConfidence: true });
    expect(opspCellNote(lState)).toBe(OPSP_LOW_CONFIDENCE_NOTE);
  });

  it("keeps the four state kinds and their signals mutually distinct", () => {
    const states: OpspCellState[] = [
      { kind: "empty" },
      { kind: "ink" },
      { kind: "pencil", lowConfidence: false },
      { kind: "pencil", lowConfidence: true },
    ];
    // Only pencil cells carry the revisit tag.
    expect(states.map(showsRevisitTag)).toEqual([false, false, true, true]);
    // Notes: empty gets the empty note, only the low-confidence pencil gets
    // the low-confidence note.
    expect(states.map(opspCellNote)).toEqual([
      OPSP_EMPTY_NOTE,
      null,
      null,
      OPSP_LOW_CONFIDENCE_NOTE,
    ]);
    // The prose tag the non-colour signal depends on stays put.
    expect(OPSP_REVISIT_TAG).toBe("revisit");
  });

  it("never renders a note as cell content — every seeded cell's text traces to answers", () => {
    for (const respondent of SEED_RESPONDENTS) {
      const cells = buildOpspCells(snapshotFrom(respondent.answers));
      for (const id of OPSP_CELL_IDS) {
        const state = resolveOpspCellState(cells[id]);
        const rendered = formatOpspCellValue(cells[id].value);
        if (state.kind === "empty") {
          // An empty cell renders nothing at all; the note lives outside it.
          expect(rendered).toBe("");
        } else {
          expect(rendered.trim().length).toBeGreaterThan(0);
          expect(rendered).not.toContain(OPSP_EMPTY_NOTE);
          expect(rendered).not.toContain(OPSP_LOW_CONFIDENCE_NOTE);
        }
      }
    }
  });
});