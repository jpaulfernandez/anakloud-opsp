import { describe, expect, it } from "vitest";
import {
  FUNCTION_CAP_MESSAGE,
  FUNCTION_ID_LIST,
  FUNCTION_LABELS,
  MAX_FUNCTION_CHIPS,
  PRIVATE_PANEL_BODY,
  PRIVATE_PANEL_HEADING,
  PRIVATE_PANEL_OPTIONAL,
  PRIVATE_PANEL_PROMPT,
  Q14_ID,
  emptyQ14Draft,
  q14IsAnswered,
  toQ14Value,
  type Q14Draft,
} from "../../lib/q14";
import {
  FUNCTION_IDS,
  Q14_QUESTION_IDS,
  QUESTIONS,
  type Q14Value,
} from "../../lib/questions";

// Pure Q14 helpers (F03-T09, ui_ux.md §4.11, anakloud-baseline-questions.md
// Q14). The function set, the chip cap, the private-panel microcopy and the
// "answered" rule are deterministic behaviour the screen and the shell's
// forward-navigation depend on, so they are verified without a browser.
//
// The two acceptances that carry the design here are the cap rule and the
// private copy: "tapping a dimmed chip produces the message, never a no-op"
// (an answered-for-twice kind of rule, expressed in the component and backed
// here by the exact message constant) and "the private field's copy is present
// and matches ui_ux §4.11" (verified verbatim against the spec below).

const TEAMMATES = [
  { id: "t-1", displayName: "Ana Reyes" },
  { id: "t-2", displayName: "Benito Cruz" },
  { id: "t-3", displayName: "Carla Santos" },
] satisfies ReadonlyArray<{ id: string; displayName: string }>;

describe("the sixteen functions (baseline Q14)", () => {
  it("offers exactly sixteen functions, matching the registry set", () => {
    expect(FUNCTION_ID_LIST).toHaveLength(16);
    expect(FUNCTION_ID_LIST).toEqual([...FUNCTION_IDS]);
    expect(Object.keys(FUNCTION_LABELS)).toHaveLength(16);
  });

  it("maps every function id to a display label in the baseline's order", () => {
    // First, last and a few in between, written verbatim from the baseline Q14
    // list — the order and wording are content the respondent sees.
    expect(FUNCTION_LABELS.product).toBe("product");
    expect(FUNCTION_LABELS.mobile_web).toBe("mobile/frontend");
    expect(FUNCTION_LABELS.data_privacy_security).toBe(
      "data privacy & security",
    );
    expect(FUNCTION_LABELS.clinical_relations).toBe(
      "clinical & regulatory liaison",
    );
    expect(FUNCTION_LABELS.onboarding_success).toBe(
      "onboarding & customer success",
    );
    expect(FUNCTION_LABELS.finance).toBe("finance & bookkeeping");
    expect(FUNCTION_LABELS.legal_ip).toBe("legal & IP");
    expect(FUNCTION_LABELS.hiring).toBe("hiring");
  });

  it("carries no emphasis marker on any label — no subset is singled out", () => {
    // The "SHALL NOT visually distinguish, reorder, or emphasise any subset"
    // rule begins in the copy: if a label carried a star, a "(core)" tag or
    // bold, that would be the emphasis leaking in. None of the sixteen does.
    for (const label of Object.values(FUNCTION_LABELS)) {
      expect(label).not.toMatch(/[★☆*]/);
      expect(label).not.toMatch(/\b(core|key|essential)\b/i);
    }
  });

  it("caps function selection at three (baseline Q14)", () => {
    expect(MAX_FUNCTION_CHIPS).toBe(3);
  });
});

describe("FUNCTION_CAP_MESSAGE", () => {
  it("is the exact line ui_ux §4.11 names", () => {
    expect(FUNCTION_CAP_MESSAGE).toBe("Pick at most 3 — swap one out.");
  });

  it("reads as a reason, not a validation error", () => {
    expect(FUNCTION_CAP_MESSAGE).not.toMatch(/\b(error|invalid|must be)\b/i);
  });
});

describe("private-panel copy (ui_ux §4.11(d))", () => {
  it("says only the facilitator sees it and it appears in no comparison or export", () => {
    expect(PRIVATE_PANEL_HEADING).toBe("Only Paul sees this one.");
    expect(PRIVATE_PANEL_BODY).toBe(
      "Not in any comparison, not in any export, not shown to the group.",
    );
  });

  it("asks the step-back question verbatim", () => {
    expect(PRIVATE_PANEL_PROMPT).toBe(
      "Is there anything that would make you step back from this, that you haven't said out loud yet?",
    );
  });

  it("states on the field that the question is optional", () => {
    expect(PRIVATE_PANEL_OPTIONAL).toBe(
      "leaving this blank is completely fine.",
    );
  });
});

describe("emptyQ14Draft", () => {
  it("produces no functions, null hours, a blank note, and a null row per teammate", () => {
    const draft = emptyQ14Draft(TEAMMATES);
    expect(draft.wants).toEqual([]);
    expect(Object.keys(draft.others)).toEqual(["t-1", "t-2", "t-3"]);
    expect(draft.others["t-1"]).toBeNull();
    expect(draft.others["t-2"]).toBeNull();
    expect(draft.others["t-3"]).toBeNull();
    expect(draft.hours).toBeNull();
    expect(draft.privateNote).toBe("");
  });

  it("runs through every teammate — none is missing a row", () => {
    const draft = emptyQ14Draft(TEAMMATES);
    for (const teammate of TEAMMATES) {
      expect(draft.others[teammate.id]).toBeDefined();
    }
  });
});

describe("q14IsAnswered", () => {
  it("is unanswered until the hours slider is set — nothing is defaulted", () => {
    // The hours slider starts unset (acceptance: "no thumb position until the
    // respondent sets one"), so an empty draft is answered false.
    expect(q14IsAnswered(emptyQ14Draft(TEAMMATES))).toBe(false);
  });

  it("is answered once hours is set, regardless of wants, others or the note", () => {
    // (a) is "up to three" and could be none, (b) is per-teammate and (d) is
    // optional, so the whole question is answered by a committed hours value.
    const draft: Q14Draft = {
      wants: [],
      others: { "t-1": null },
      hours: 30,
      privateNote: "",
    };
    expect(q14IsAnswered(draft)).toBe(true);
  });
});

describe("toQ14Value", () => {
  it("maps an answered draft onto the §3.1 stored shape, dropping null rows", () => {
    const draft: Q14Draft = {
      wants: ["product", "backend", "data_privacy_security"],
      others: { "t-1": "product", "t-2": null, "t-3": "finance" },
      hours: 40,
      privateNote: "I may need to leave in six months.",
    };
    const value: Q14Value = toQ14Value(draft);
    expect(value).toEqual({
      wants: draft.wants,
      others: { "t-1": "product", "t-3": "finance" },
      hours: 40,
      private_note: "I may need to leave in six months.",
    });
  });

  it("carries `private_note` as its own key, to be split at persist time", () => {
    const drafted: Partial<Q14Draft> & { hours: number; privateNote: string } = {
      wants: ["qa"],
      others: {},
      hours: 8,
      privateNote: "off to a better offer",
    };
    const value = toQ14Value(drafted as Q14Draft);
    // The note is not merged into `wants`/`others`; it stays a separate field
    // that upsertAnswer (F01-T03) moves to a q14d private row.
    expect(value).toHaveProperty("private_note");
    expect(value.private_note).toBe("off to a better offer");
  });

  it("refuses to map an unset draft", () => {
    expect(() => toQ14Value(emptyQ14Draft(TEAMMATES))).toThrow();
  });
});

describe("registry wiring", () => {
  it("registers Q14 as required with both FR-10 inputs", () => {
    const q14 = QUESTIONS.find((q) => q.id === "q14");
    expect(q14?.inputTypes).toEqual(["capped_multi_select", "numeric_slider"]);
    expect(q14?.required).toBe(true);
  });

  it("updates the Q14 guard in lockstep with the registry", () => {
    expect(Q14_QUESTION_IDS).toEqual(["q14"]);
    expect(Q14_ID).toBe("q14");
  });
});