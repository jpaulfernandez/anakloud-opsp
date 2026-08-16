import { describe, expect, it } from "vitest";
import {
  Q1_MIN_CHARS,
  charCountLabel,
  longTextIsAnswered,
} from "../../lib/long-text";

// Pure long-text helpers (F03-T02, ui_ux.md §4.4). The counter format and the
// "is this question answered" rule are deterministic behaviour the shell's
// forward-navigation depends on, so they are verified without a browser.

describe("charCountLabel", () => {
  it("counts up to the minimum, so it reads as encouragement not a limit", () => {
    // "142 of 200" — never "58 remaining". The acceptance criterion pins the
    // wording: the label names the running total and the target, not what is
    // left over.
    expect(charCountLabel(142, Q1_MIN_CHARS)).toBe("142 of 200");
  });

  it("renders the count verbatim, including past the minimum", () => {
    const label = charCountLabel(203, Q1_MIN_CHARS);
    expect(label.startsWith("203 of 200")).toBe(true);
    expect(label).not.toContain("remaining");
    expect(label).not.toContain("left");
  });
});

describe("longTextIsAnswered", () => {
  it("tests the requirement: Q1's minimum is 200 characters", () => {
    expect(Q1_MIN_CHARS).toBe(200);
  });

  it("treats any non-empty text as answered", () => {
    expect(longTextIsAnswered({ text: "why we exist", cause: "other" })).toBe(
      true,
    );
    expect(longTextIsAnswered({ text: "a moment worth copying" })).toBe(true);
  });

  it("treats whitespace alone as unanswered", () => {
    expect(longTextIsAnswered({ text: "   " })).toBe(false);
    expect(longTextIsAnswered({ text: "" })).toBe(false);
  });

  it("requires the long text, not the cause: a cause without text is unanswered", () => {
    // Q13 is required for its long text (baseline Part A); picking a cause
    // without writing an explanation is not an answer.
    expect(longTextIsAnswered({ text: "", cause: "ran out of money" })).toBe(
      false,
    );
    expect(longTextIsAnswered({ text: "We drifted", cause: "the team drifted apart" })).toBe(
      true,
    );
  });
});