import { describe, expect, it } from "vitest";
import {
  Q2_BECAUSE_LABEL,
  Q2_WHO_LABEL,
  sentenceCompletionIsAnswered,
} from "../../lib/sentence-completion";

// Pure sentence-completion helpers (F03-T03, ui_ux.md §4.5). The two fragments
// and the "is this question answered" rule are deterministic behaviour the
// shell's forward-navigation depends on, so they are verified without a
// browser.

describe("sentence completion fragments (F03-T03)", () => {
  it("labels each blank with its sentence fragment", () => {
    // The two blanks are labelled by the sentence fragments they sit in, so a
    // field can carry its fragment as a visible label and as its accessible
    // name — the sentence structure survives instead of two anonymous boxes.
    expect(Q2_WHO_LABEL).toBe("The people who would miss it most are");
    expect(Q2_BECAUSE_LABEL).toBe("because");
  });

  it("the two fragments join into the exact baseline sentence", () => {
    // "The people who would miss it most are ____, because ____." — the comma
    // and full stop come from the surrounding copy, the blanks from the pair.
    expect(`${Q2_WHO_LABEL} ____, ${Q2_BECAUSE_LABEL} ____.`).toBe(
      "The people who would miss it most are ____, because ____.",
    );
  });
});

describe("sentenceCompletionIsAnswered", () => {
  it("treats a sentence with both blanks filled as answered", () => {
    expect(
      sentenceCompletionIsAnswered({
        who: "Therapy center admins",
        because: "they'd go back to schedules by hand",
      }),
    ).toBe(true);
  });

  it("treats a blank first or second half as unanswered", () => {
    // A sentence with an empty half is not a complete sentence (Q2 is required).
    expect(sentenceCompletionIsAnswered({ who: "", because: "we haven't" })).toBe(
      false,
    );
    expect(
      sentenceCompletionIsAnswered({ who: "nobody yet", because: " " }),
    ).toBe(false);
    expect(sentenceCompletionIsAnswered({ who: "  ", because: "" })).toBe(false);
  });

  it("persists the two halves independently: whitespace on one side does not hide a real answer elsewhere", () => {
    // The shape is `{ who, because }`; each half stands alone but both must
    // carry content for the question to count as answered.
    expect(
      sentenceCompletionIsAnswered({ who: "nobody yet", because: "no one would" }),
    ).toBe(true);
  });
});