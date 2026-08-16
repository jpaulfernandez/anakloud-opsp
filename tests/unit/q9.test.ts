import { describe, expect, it } from "vitest";
import { q9FieldLabel, q9IsAnswered } from "../../lib/q9";

// Pure Q9 helpers (F03-T10). The three-field labels and the "all three
// required" rule are deterministic behaviour the shell's forward-navigation
// depends on, so they are verified without a browser. The acceptance that Q9
// "persists as three distinct strings and all three are required" lives here
// in the isAnswered rule.

describe("q9FieldLabel", () => {
  it("labels the three refusal fields distinctly so none is an anonymous box", () => {
    expect(q9FieldLabel(1)).toBe("Not doing 1");
    expect(q9FieldLabel(2)).toBe("Not doing 2");
    expect(q9FieldLabel(3)).toBe("Not doing 3");
  });
});

describe("q9IsAnswered", () => {
  it("is answered only when all three refusals carry trimmed text", () => {
    expect(
      q9IsAnswered({
        items: [
          "Not delivering teletherapy ourselves.",
          "Not adult rehab.",
          "No expansion outside the Philippines before 200 centers.",
        ],
      }),
    ).toBe(true);
  });

  it("is not answered while any one of the three fields is blank", () => {
    const filled: [string, string, string] = [
      "No teletherapy.",
      "No adult rehab.",
      "No expansion before 200 centers.",
    ];
    expect(q9IsAnswered({ items: ["", filled[1], filled[2]] })).toBe(false);
    expect(q9IsAnswered({ items: [filled[0], "   ", filled[2]] })).toBe(false);
    expect(q9IsAnswered({ items: [filled[0], filled[1], ""] })).toBe(false);
  });

  it("is not answered when fewer than three lines are present", () => {
    expect(q9IsAnswered({ items: ["No teletherapy.", "", ""] })).toBe(false);
  });
});