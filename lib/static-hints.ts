// Static hints and examples (F05-T02, spec.md §7.1, tech_infrastructure.md
// §6.3). This is the deterministic sibling of the live model: every §7.1
// validator failure has a fixed hint string in the coach's tone, and Q3, Q7
// and Q11 carry one pre-written example.
//
// The constraints are the same ones the output guard runs on model output
// (tech_infrastructure.md §5.4), applied up front:
//   - hints stay ≤25 words and contain no digits (a number is a suggested
//     target);
//   - hints and examples never mention healthcare, education, software
//     products, or any of the four app names;
//   - examples are drawn from a neutral domain only — a bakery, gym, laundry,
//     courier, or hardware store (FR-19).
// This is a deliberate anchoring cost (spec/README): at L2 every respondent
// who requests an example sees the same one. It is documented and accepted,
// so there is no attempt here to generate variety.
//
// Pure data — no I/O, no network, consistent with the F05 pure-function rule.

/**
 * One question's static coach content. `hint` is the fixed string served for
 * any failure of that question; `example` is present only for the three
 * questions §7.1 singles out (Q3, Q7, Q11).
 */
export interface StaticHint {
  hint: string;
  example?: string;
}

/**
 * The questions that carry a §7.1 validator and therefore a fixed hint —
 * every validator question in spec.md §7.1, including Q1, Q12 and Q14, which
 * are *validated* but not *coached* (§6.3 draws that line). A hint exists for
 * each of these so every validator failure has one.
 */
export const VALIDATED_QUESTION_IDS = [
  "q1", "q3", "q4", "q6", "q7", "q9", "q10", "q11", "q12", "q14",
] as const;
export type ValidatedQuestionId = (typeof VALIDATED_QUESTION_IDS)[number];

/**
 * Fixed, pre-written coach content per validated question. Written once,
 * matched to the coach's tone (ui_ux.md §5.3): short, slightly informal,
 * never congratulatory. Each hint points at the shape of a better answer
 * without inventing one.
 */
export const STATIC_HINTS: Record<ValidatedQuestionId, StaticHint> = {
  q1: {
    hint:
      "Say more here — a few sentences showing why this matters to you. There's room for the full picture.",
  },
  q3: {
    hint:
      "Name what you would count, then the number and the unit. Make it something you could look up next quarter.",
    example:
      "A courier counts deliveries done each day — the shape is a thing you count, a number and a unit. Yours will be about your business, not couriers.",
  },
  q4: {
    hint:
      "One clear statement — a single sentence. Trim it to the core idea.",
  },
  q6: {
    hint:
      "Go beyond that — the reason matters. Spell out why you chose this, in your own words.",
  },
  q7: {
    hint:
      "One promise, not a list. Pick the single outcome this comes down to.",
    example:
      "A gym's version: Members finish a full session each visit. One clear outcome, easy to verify. Yours will be about your business, not fitness.",
  },
  q9: {
    hint:
      "Give real detail for each of the three — enough to see the situation, not a one-word label.",
  },
  q10: {
    hint:
      "All four parts are needed — who pays, the amount, and the month it starts. Fill each one.",
  },
  q11: {
    hint:
      "Make the done when something you can point at — a number, a date, or a concrete result.",
    example:
      "A bakery's version: When a full pallet of flour is moved in a week. A number or a date makes it checkable. Yours will be about your business, not baking.",
  },
  q12: {
    hint:
      "Too long — a short name says it. One clean phrase, easy to say aloud.",
  },
  q14: {
    hint:
      "Pick at most three, and a realistic weekly total. Everything else stays off the list.",
  },
};