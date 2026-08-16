// Question shell navigation (F03-T01, FR-6, FR-8, FR-9, ui_ux.md §4.3, D1).
//
// Pure functions, no I/O, no network — the same discipline as the validators
// (AGENTS.md): the navigation rules are part of what PR3 depends on staying
// deterministic. The shell renders one question per screen; the only questions
// here are "which question is next", "may the respondent advance" and "what
// does the screen say when they may not". Forward movement is the only branch
// that needs a rule: FR-9 says skipping forward is allowed for optional
// questions only, so a required question without an answer blocks Continue and
// the screen explains itself (it never greys, disables or silently no-ops —
// "not a generic disabled state", F03-T01 acceptance).
//
// QUESTION_IDS order is the 15-question build order from
// tech_infrastructure.md §12 / the registry; "next" and "previous" are computed
// from it so a question's neighbours always agree with the registry.

import { QUESTION_IDS, QUESTION_MAP, type QuestionId } from "./questions";

/** The current question's position in the 15-question sequence. */
export interface QuestionNeighbors {
  /** Zero-based registry index, for any arithmetic. */
  index: number;
  /** One-based "n of 15" position, what the progress header shows. */
  absolute: number;
  /** The question immediately before this one, or null on the first. */
  prev: QuestionId | null;
  /** The question immediately after this one, or null on the last. */
  next: QuestionId | null;
  isFirst: boolean;
  isLast: boolean;
}

/**
 * True only for an id in the q1..q15 registry. A type guard, so a caller that
 * passes this check can treat the string as a QuestionId downstream.
 */
export function isRegisteredQuestion(id: string): id is QuestionId {
  return (QUESTION_IDS as readonly string[]).includes(id);
}

/**
 * Map a `/q/[id]` URL segment to a registry question id. The URL carries the
 * plain number (the "3" in "/q/3", mirroring the "n of 15" the progress header
 * shows), while the registry id is "q1".."q15". Returns null for a segment
 * that names no question, so an out-of-range URL 404s.
 */
export function toQuestionId(segment: string): QuestionId | null {
  const qid = `q${segment}` as QuestionId;
  return isRegisteredQuestion(qid) ? qid : null;
}

/** The `/q/[id]` URL segment for a registry question id (the number only). */
export function questionRouteSegment(id: QuestionId): string {
  return id.slice(1);
}

/**
 * The neighbours of a registered question, or null for an unknown id. Precise
 * so an invalid URL (anything outside q1..q15) can 404 before a page renders.
 */
export function questionNeighbors(id: string): QuestionNeighbors | null {
  const index = (QUESTION_IDS as readonly string[]).indexOf(id);
  if (index === -1) return null;
  const last = QUESTION_IDS.length - 1;
  return {
    index,
    absolute: index + 1,
    prev: index > 0 ? QUESTION_IDS[index - 1] : null,
    next: index < last ? QUESTION_IDS[index + 1] : null,
    isFirst: index === 0,
    isLast: index === last,
  };
}

/** The explanatory line shown when a required question blocks Continue. */
export const REQUIRED_UNANSWERED_MESSAGE = "Answer this before moving on.";

/**
 * Whether the respondent may advance past `id` (FR-9). A required question
 * without an answer in `answered` blocks forward movement with a reason the
 * screen renders verbatim; an optional question never blocks, so it can be
 * skipped — advanced past without answering. `answered` is the set of question
 * ids holding an answer in the current session; it is empty until the input
 * components (F03-T02 onwards) populate it.
 */
export type AdvanceDecision =
  | { kind: "advance" }
  | { kind: "blocked"; reason: string };

export function canAdvance(
  id: QuestionId,
  answered: ReadonlySet<QuestionId>,
): AdvanceDecision {
  const question = QUESTION_MAP[id];
  if (question.required && !answered.has(id)) {
    return { kind: "blocked", reason: REQUIRED_UNANSWERED_MESSAGE };
  }
  return { kind: "advance" };
}