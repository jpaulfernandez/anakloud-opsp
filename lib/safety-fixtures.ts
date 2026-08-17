// F18-T03 safety-path fixtures (source item M08, spec.md §7 §8). Pure data, no
// I/O, no network — the same discipline as lib/static-hints.ts and
// lib/coach-fixtures.ts.
//
// These are synthetic answers that exercise the *safety* path of the Gemini
// provider, not the coach's §5.4 containment path (that set lives in
// coach-fixtures.ts). They carry candid-risk language — the pre-mortem and
// walk-away subject matter people actually write candidly — because a Gemini
// content filter is most likely to refuse exactly those turns. Every turn is
// driven through the coach request shape (a coachable question + the one answer
// under evaluation) so the faked-transport tests prove the block degrades to
// the deterministic L2 sibling instead of reaching a browser.
//
// The privacy rule (spec.md §8) is an absolute: Q14(d) never leaves the
// database. So none of these is a real private row, and none carries a
// database-derived answer, a `q14d` label, a respondent identity, a respondent
// id, or any private metadata. They are invented prose that *resembles* the
// kind of risk candour the product collects, deliberately vaguer than any real
// row (no one is named, no company is named, no dates or specifics a respondent
// could have written — see COVERAGE.md "Q14(d) safety fixtures"). The offline
// test asserts exactly this so a future edit cannot silently smuggle a real row
// or a label in.

import type { CoachableQuestionId } from "./coach-fixtures";

/** Which candid-risk register a fixture belongs to. */
export type SafetyFixtureKind = "pre_mortem" | "walk_away";

/** One synthetic candid-risk answer the safety path is exercised with. */
export interface SafetyFixture {
  id: string;
  /** A coachable question, so the turn travels in the coach's request shape. */
  questionId: CoachableQuestionId;
  kind: SafetyFixtureKind;
  /** Short human title, for the live safety-path runner's report. */
  label: string;
  /** The answer text sent to the coach — candid-risk language, but synthetic. */
  answer: string;
}

/** A marker every pre-mortem fixture's answer must carry. */
export const PRE_MORTEM_MARKERS = [
  "the company died",
  "how it died",
  "it collapsed",
  "the whole thing failed",
] as const;

/** A marker every walk-away fixture's answer must carry. */
export const WALK_AWAY_MARKERS = [
  "i would walk away",
  "i would step back",
  "i would quit",
  "i would leave",
] as const;

/**
 * Six synthetic candid-risk turns across the coachable set: three pre-mortem
 * (how the company died) and three walk-away (what would make someone step
 * back). Every string carries its register's marker so the offline test can
 * prove the set really does contain the candid language the safety path is
 * meant to absorb — bounded, invented, and free of any private row or identity.
 */
export const SAFETY_FIXTURES: readonly SafetyFixture[] = [
  // Pre-mortem — candid language about the company dying.
  { id: "s1", questionId: "q3", kind: "pre_mortem",
    label: "pre-mortem: collapses",
    answer: "We stopped shipping in October and the company died quietly while nobody watched the plan." },
  { id: "s2", questionId: "q7", kind: "pre_mortem",
    label: "pre-mortem: fail",
    answer: "Three quarters of no revenue, the co-founders stopped talking, and the whole thing failed from drift." },
  { id: "s5", questionId: "q6", kind: "pre_mortem",
    label: "risk: avoidance",
    answer: "We avoid every hard conversation, so by the time we admit the company died there is no one left to save it." },

  // Walk-away — candid language about stepping back / quitting.
  { id: "s3", questionId: "q4", kind: "walk_away",
    label: "walk-away: step back",
    answer: "If the numbers keep missing every month, I would step back rather than watch us talk ourselves into a lie." },
  { id: "s4", questionId: "q9", kind: "walk_away",
    label: "walk-away: quit",
    answer: "If we choose the easy customers over the honest ones, I would quit before I helped polish that." },
  { id: "s6", questionId: "q11", kind: "walk_away",
    label: "risk: burnout",
    answer: "If the team burns out from the treadmill, I would walk away rather than watch the founding promise become a grind." },
];