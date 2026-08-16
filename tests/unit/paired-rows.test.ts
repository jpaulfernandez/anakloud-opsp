import { describe, expect, it } from "vitest";
import {
  PAIRED_ROWS_STAR_NOTE,
  emptyPairedRowsDraft,
  pairedRowsIsAnswered,
  toPairedRowsValue,
  type PairedRowsDraft,
} from "../../lib/paired-rows";
import {
  PAIRED_ROWS_QUESTION_IDS,
  QUESTIONS,
  type Q11Value,
} from "../../lib/questions";

// Pure paired-rows + star helpers (F03-T08, ui_ux.md §4.10,
// anakloud-baseline-questions.md Q11). The "answered" rule and the star note
// are deterministic behaviour the shell's forward-navigation and the screen's
// microcopy depend on, so they are verified without a browser.
//
// The one acceptance that carries the design is "completing only block one
// passes the required check" — only the first rock's What + Done when are
// required. Blocks two and three are optional, and the star is not needed to
// pass, so a single well-formed rock is a full Q11 answer.

function answeredBlockOneDraft(
  overrides: Partial<PairedRowsDraft["rocks"][0]> = {},
): PairedRowsDraft {
  return {
    ...emptyPairedRowsDraft(),
    rocks: [
      {
        what: "Onboard beta centers",
        done_when: "8 centers have each logged 20+ sessions",
        ...overrides,
      },
      { what: "", done_when: "" },
      { what: "", done_when: "" },
    ],
  };
}

describe("pairedRowsIsAnswered", () => {
  it("is answered by only the first block — blocks two and three are optional", () => {
    // The acceptance: "Completing only block one passes the required check."
    const draft = answeredBlockOneDraft();
    expect(draft.rocks[1]).toEqual({ what: "", done_when: "" });
    expect(draft.rocks[2]).toEqual({ what: "", done_when: "" });
    expect(pairedRowsIsAnswered(draft)).toBe(true);
  });

  it("is unanswered until the first block has both a What and a Done when", () => {
    expect(pairedRowsIsAnswered(emptyPairedRowsDraft())).toBe(false);
    expect(pairedRowsIsAnswered(answeredBlockOneDraft({ what: "" }))).toBe(
      false,
    );
    expect(pairedRowsIsAnswered(answeredBlockOneDraft({ done_when: "" }))).toBe(
      false,
    );
    expect(pairedRowsIsAnswered(answeredBlockOneDraft({ what: "  " }))).toBe(
      false,
    );
    // Not done-able without a done-condition: "improve onboarding" is not an
    // answer (baseline Q11).
    expect(
      pairedRowsIsAnswered(answeredBlockOneDraft({ done_when: "   " })),
    ).toBe(false);
  });

  it("is answered regardless of the star — the star is not required to pass", () => {
    // A single well-formed rock with no star chosen still passes the required
    // check (F03-T08: only block one is required).
    expect(pairedRowsIsAnswered(answeredBlockOneDraft())).toBe(true);
  });
});

describe("PAIRED_ROWS_STAR_NOTE", () => {
  it("is the exact line ui_ux §4.10 names", () => {
    expect(PAIRED_ROWS_STAR_NOTE).toBe(
      "Only one can be the most important — that's the point.",
    );
  });

  it("reads as a reason, not a validation error", () => {
    // The note must sound like the spec's microcopy principle ("make the
    // constraints sound like reasons") — never an error-prefixed message. It is
    // a plain standalone statement, carrying none of the error vocabulary a
    // validation failure would use.
    expect(PAIRED_ROWS_STAR_NOTE).not.toMatch(/\b(error|invalid|must be)\b/i);
    expect(PAIRED_ROWS_STAR_NOTE).toMatch(/that's the point/i);
    expect(PAIRED_ROWS_STAR_NOTE.match(/\./g)?.length).toBe(1);
  });
});

describe("toPairedRowsValue", () => {
  it("maps an answered draft onto the §3.1 stored shape", () => {
    const draft: PairedRowsDraft = {
      ...answeredBlockOneDraft(),
      rocks: [
        { what: "Onboard beta centers", done_when: "8 centers, 20+ sessions" },
        { what: "Prove the referral loop", done_when: "15 referrals E2E" },
        { what: "", done_when: "" },
      ],
      starred: 0,
    };
    const value: Q11Value = toPairedRowsValue(draft);
    expect(value).toEqual({
      rocks: draft.rocks,
      starred: 0,
    });
  });

  it("refuses to map an unstarred draft", () => {
    // `starred` is typed 0|1|2 in §3.1, so an answer with no #1 has nowhere to
    // record that; the star is decided at persist time.
    expect(() => toPairedRowsValue(answeredBlockOneDraft())).toThrow();
  });
});

describe("emptyPairedRowsDraft", () => {
  it("produces three blank blocks and no star", () => {
    const draft = emptyPairedRowsDraft();
    expect(draft.rocks).toHaveLength(3);
    for (const rock of draft.rocks) {
      expect(rock).toEqual({ what: "", done_when: "" });
    }
    expect(draft.starred).toBeNull();
  });
});

describe("registry wiring", () => {
  it("registers Q11 as a required paired-rows question", () => {
    const q11 = QUESTIONS.find((q) => q.id === "q11");
    expect(q11?.inputTypes).toContain("paired_rows_star");
    expect(q11?.required).toBe(true);
    // Exactly the one question this input belongs to.
    expect(PAIRED_ROWS_QUESTION_IDS).toEqual(["q11"]);
  });
});