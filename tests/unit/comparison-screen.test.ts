import { describe, expect, it } from "vitest";
import {
  ATTRIBUTED_CONFIRM_MESSAGE,
  comparisonAnswerText,
  divergenceBadgeLabel,
  shuffleAnswers,
} from "../../lib/comparison-screen";

// F10-T03 — the comparison screen's pure model. The screen renders the
// deterministic divergence verdict and each answer's full text; these two
// helpers are what the acceptance criteria hang on, and they are pure so they
// are testable without a browser or a database (PR3 holds even with the AI key
// absent — there is no provider path here at all).
//
// The one privacy decision the screen makes is in the pure layer: Q14(b) keys
// teammate attributions by respondent id, and in anonymised mode those ids
// must never reach a card (ui_ux.md §4.18 — the anonymised default exists so
// nothing identifying goes up on the wall). That redaction is asserted here.

describe("divergenceBadgeLabel (F10-T03)", () => {
  it("maps each deterministic verdict to a display badge", () => {
    expect(divergenceBadgeLabel("aligned")).toBe("Aligned");
    expect(divergenceBadgeLabel("soft split")).toBe("Soft split");
    expect(divergenceBadgeLabel("hard split")).toBe("Hard split");
    expect(divergenceBadgeLabel("manual review")).toBe("Manual review");
  });

  it("yields no badge where there is no verdict", () => {
    // A closed, non-confidence question reports agreement but is never
    // classified aligned/soft/hard (FR-31); no badge then.
    expect(divergenceBadgeLabel(null)).toBeNull();
  });
});

describe("comparisonAnswerText (F10-T03)", () => {
  it("renders an open-text answer fully", () => {
    const text =
      "Children with delay wait months for assessment and travel hours for therapy.";
    expect(
      comparisonAnswerText("q1", { text }, true),
    ).toBe(text);
  });

  it("renders a composite closed answer (Q3 metric triple)", () => {
    const out = comparisonAnswerText(
      "q3",
      { metric: "paying centers", value: 300, unit: "paying_centers", why: "adoption" },
      true,
    );
    expect(out).toContain("paying centers: 300 paying_centers");
    expect(out).toContain("adoption");
  });

  it("redacts teammate ids from Q14(b) in anonymised mode", () => {
    const teammateId = "20000000-0000-0000-0000-000000000099";
    const value = {
      wants: ["product"],
      others: { [teammateId]: "backend" },
      hours: 30,
    };
    const anonymised = comparisonAnswerText("q14", value, true);
    // The respondent identifier never reaches the card.
    expect(anonymised).not.toContain(teammateId);
    // The attribution is still present, just without identity.
    expect(anonymised).toContain("Wants to own");
    expect(anonymised).toContain("backend");
  });
});

describe("ATTRIBUTED_CONFIRM_MESSAGE (F10-T04)", () => {
  it("pins the confirmation wording verbatim", () => {
    // ui_ux.md §4.18 fixes the string; anyone editing it changes the product
    // behaviour and this test.
    expect(ATTRIBUTED_CONFIRM_MESSAGE).toBe(
      "This shows names. Don't use this while projecting.",
    );
  });
});

describe("shuffleAnswers (F10-T04)", () => {
  it("is driven deterministically by the supplied random pivots", () => {
    // Fisher–Yates with a fixed pivot sequence: () => 0 swaps the last index
    // with index 0 at every step, () => 0.5 reaches a distinct permutation.
    expect(shuffleAnswers(["a", "b", "c", "d"], () => 0)).toEqual([
      "b", "c", "d", "a",
    ]);
    expect(shuffleAnswers(["a", "b", "c", "d"], () => 0.5)).toEqual([
      "a", "d", "b", "c",
    ]);
  });

  it("always returns a full permutation and never mutates the input", () => {
    const input = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
    const frozen = [...input];
    const out = shuffleAnswers(input);

    // Every element present exactly once, and the source array untouched.
    expect(out).toHaveLength(input.length);
    expect([...out].sort()).toEqual([...input].sort());
    expect(input).toEqual(frozen);
  });

  it("leaves length-zero and length-one arrays unchanged", () => {
    expect(shuffleAnswers([])).toEqual([]);
    expect(shuffleAnswers(["only"], () => 0)).toEqual(["only"]);
  });
});