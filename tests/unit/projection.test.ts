import { describe, expect, it } from "vitest";
import { projectQuestion } from "../../lib/projection";
import { classifyDivergence } from "../../lib/divergence";
import { divergenceBadgeLabel } from "../../lib/comparison-screen";
import type { DivergenceAnswerInput } from "../../lib/divergence";
import type { ComparisonAnswerAnonymised } from "../../lib/comparison";

// F10-T06 — the projection sheet's pure model. The sheet is the strictest
// anonymisation in the product: unconditionally anonymised under any option,
// with no names, emails, respondent ids or private rows. These tests pin that
// the shaping function consumes only the anonymised ComparisonAnswerAnonymised
// shape and that its output (text + confidence) never carries identity, plus
// the badge and full-text legibility the page renders. The function is pure
// (PR3), so it is exercised here without a browser or a database.

/** Build a DivergenceAnswerInput for scoring in a test. */
function input(value: unknown, confidence: number | null = null): DivergenceAnswerInput {
  return { value, confidence, is_private: false };
}

/** Wrap an anonymised answer so it can be fed to projectQuestion. */
function anon(value: unknown, confidence: number | null = null): ComparisonAnswerAnonymised {
  return { value, confidence };
}

describe("projectQuestion (F10-T06)", () => {
  it("renders an open-text question with its full text and a manual-review badge", () => {
    const text =
      "Children with delay wait months for assessment and travel hours for therapy.";
    const divergence = classifyDivergence("q1", [input({ text })]);
    const out = projectQuestion("q1", {
      answers: [anon({ text })],
      divergence,
    });

    expect(out.questionId).toBe("q1");
    expect(out.section).toBe("Why this exists");
    expect(out.text).toContain("Why does Anakloud need to exist");
    // The full answer is carried through untruncated.
    expect(out.answers[0].text).toBe(text);
    // Open text is flagged for manual review (FR-31).
    expect(out.badge).toEqual({
      category: "manual review",
      label: divergenceBadgeLabel("manual review"),
    });
  });

  it("maps a closed confidence verdict to its badge", () => {
    const mA = input(
      { metric: "paying centers", value: 300, unit: "paying_centers", why: "adoption" },
      2,
    );
    const mB = input(
      { metric: "renewals", value: 80, unit: "renewals", why: "retention" },
      3,
    );
    const divergence = classifyDivergence("q3", [mA, mB]);
    expect(divergence.category).toBe("soft split");

    // Confidence is passed through per card.
    const out = projectQuestion("q3", {
      answers: [
        anon(mA.value, mA.confidence),
        anon(mB.value, mB.confidence),
      ],
      divergence,
    });
    expect(out.badge).toEqual({ category: "soft split", label: "Soft split" });
    expect(out.answers.map((a) => a.confidence)).toEqual([2, 3]);
  });

  it("carries no badge where there is no verdict", () => {
    // A closed, non-confidence question reports agreement but never
    // aligned/soft/hard (FR-31) — nothing to project then.
    const divergence = classifyDivergence("q5", [
      input({ pays: ["parent"], decides: [], uses: [], benefits: [] }),
      input({ pays: ["parent"], decides: [], uses: [], benefits: [] }),
    ]);
    const out = projectQuestion("q5", {
      answers: [anon({ pays: ["parent"] })],
      divergence,
    });
    expect(out.badge).toBeNull();
  });

  it("redacts Q14(b) teammate ids so no respondent identity reaches a card", () => {
    const teammateId = "30000000-0000-0000-0000-0000000000ab";
    const value = {
      wants: ["product"],
      others: { [teammateId]: "backend" },
      hours: 30,
    };
    const divergence = classifyDivergence("q14", [input(value)]);
    const out = projectQuestion("q14", {
      answers: [anon(value)],
      divergence,
    });

    const rendered = out.answers[0].text;
    // The respondent identifier must not reach a card that goes up on a wall.
    expect(rendered).not.toContain(teammateId);
    // The attribution is still present, just without identity.
    expect(rendered).toContain("a teammate");
    expect(rendered).toContain("backend");
  });

  it("emits no identity-carrying keys in either the card or the block", () => {
    const value = { wants: ["product"], others: {}, hours: 30 };
    const divergence = classifyDivergence("q14", [input(value)]);
    const out = projectQuestion("q14", {
      answers: [anon(value, 5)],
      divergence,
    });

    // A card is exactly { text, confidence }.
    expect(Object.keys(out.answers[0]).sort()).toEqual(["confidence", "text"]);
    // The block is question id, section, text, badge and answers — nothing
    // else, so a name/email/id field cannot slip into the payload.
    expect(Object.keys(out).sort()).toEqual([
      "answers",
      "badge",
      "questionId",
      "section",
      "text",
    ]);
  });
});