import { describe, expect, it } from "vitest";
import {
  CAPPED_SHORT_TEXT_ID_LIST,
  SHORT_TEXT_CAPS,
  clampToCap,
  shortTextCounterLabel,
  shortTextIsAnswered,
} from "../../lib/short-text";

// Pure capped short-text helpers (F03-T10). The per-question caps, the
// input-time clamp and the "answered" rule are deterministic behaviour the
// shell's forward-navigation and the input components depend on, so they are
// verified without a browser — including the acceptance that caps are enforced
// at input (clampToCap) rather than only emitted as an error later.

describe("SHORT_TEXT_CAPS", () => {
  it("sets the three hard caps verbatim from the baseline: 140, 120, 40", () => {
    expect(SHORT_TEXT_CAPS.q4).toBe(140); // ten years, one sentence
    expect(SHORT_TEXT_CAPS.q7).toBe(120); // one line, one promise
    expect(SHORT_TEXT_CAPS.q12).toBe(40); // name the quarter
  });

  it("keys exactly the three capped ids q4, q7, q12", () => {
    expect([...CAPPED_SHORT_TEXT_ID_LIST]).toEqual(["q4", "q7", "q12"]);
  });
});

describe("clampToCap", () => {
  it("returns text shorter than the cap untouched", () => {
    expect(clampToCap("short", 40)).toBe("short");
  });

  it("returns text exactly at the cap untouched", () => {
    const exact = "x".repeat(40);
    expect(clampToCap(exact, 40)).toBe(exact);
  });

  it("truncates text past the cap, so the cap is enforced at input", () => {
    // The acceptance: "Character caps are enforced at input, not only at
    // validation". A field driven through this never lets the value exceed the
    // cap, so no over-long value can reach the stored shape later.
    expect(clampToCap("y".repeat(145), 140).length).toBe(140);
    expect(clampToCap("y".repeat(145), 140)).toBe("y".repeat(140));
  });
});

describe("shortTextCounterLabel", () => {
  it("counts up to the cap, mirroring the long-text minimum counter", () => {
    // Consistent with Q1's "142 of 200": "32 of 140", never "108 remaining".
    expect(shortTextCounterLabel(32, 140)).toBe("32 of 140");
    expect(shortTextCounterLabel(0, 120)).toBe("0 of 120");
    expect(shortTextCounterLabel(40, 40)).toBe("40 of 40");
  });
});

describe("shortTextIsAnswered", () => {
  it("is answered when the line holds trimmed text", () => {
    expect(shortTextIsAnswered({ text: "Every child identified before five" })).toBe(
      true,
    );
  });

  it("is not answered for an empty or whitespace-only line", () => {
    expect(shortTextIsAnswered({ text: "" })).toBe(false);
    expect(shortTextIsAnswered({ text: "   " })).toBe(false);
  });
});