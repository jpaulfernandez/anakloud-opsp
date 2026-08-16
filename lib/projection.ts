// F10-T06 — the projection sheet's pure model (FR-34, ui_ux.md §4.18). A
// projection-ready comparison sheet is the export the facilitator puts up on
// the wall during the session, so it carries the strictest anonymisation in
// the product: unconditionally anonymised, no names, emails, respondent ids
// or private rows under any option.
//
// The privacy posture is decided here, structurally, before any rendering.
// projectQuestion consumes only the anonymised ComparisonAnswerAnonymised
// shape — value and confidence, with no identity field that could leak — and
// produces nothing but a plain text string plus a numeric confidence. There is
// no input type for names, so no code path can feed them in, and unlike the
// comparison board there is deliberately no attributed mode to reach. The
// answer text then runs through the same wall-safety formatter as the
// comparison screen (comparisonAnswerText with anonymise=true), which redacts
// Q14(b)'s teammate respondent ids to a neutral label. Private rows never
// reach this module at all: the page fetches through
// listPublicAnswersForQuestion (lib/answers.ts), which filters `is_private`
// in the SQL, so the Q14(d) note is absent before anything is shaped here.
//
// Everything else is legibility — the divergence verdict badge is carried
// through unchanged so the sheet reads at a projector's distance, and the page
// layers the print stylesheet conventions (a break may fall between cards but
// never through one, and no chrome prints) on top.

import { comparisonAnswerText, divergenceBadgeLabel } from "./comparison-screen";
import { QUESTION_MAP, type QuestionId } from "./questions";
import type { ComparisonAnswerAnonymised } from "./comparison";
import type { DivergenceCategory, DivergenceResult } from "./divergence";

/** One answer's renderable card: text and confidence only, never identity. */
export interface ProjectionAnswerCard {
  text: string;
  confidence: number | null;
}

/** The deterministic divergence verdict rendered on a projection block. */
export type ProjectionBadgeCategory =
  | DivergenceCategory
  | "manual review";

/**
 * One question's block on the projection sheet. `badge` is the deterministic
 * divergence verdict (FR-31) or null where there is none; answers is the full,
 * untruncated anonymised set.
 */
export interface ProjectionQuestion {
  questionId: QuestionId;
  section: string;
  text: string;
  badge: { category: ProjectionBadgeCategory; label: string } | null;
  answers: ProjectionAnswerCard[];
}

/**
 * Shape one question's already-anonymised comparison into its projection-sheet
 * block. The input's answers are typed as ComparisonAnswerAnonymised, so the
 * function cannot be called with names or respondent ids — the anonymised
 * posture is a property of the type, not a filter anyone could forget. Answer
 * text goes through comparisonAnswerText(..., true), the same Q14(b) redaction
 * the comparison screen applies, so nothing identifying reaches a card.
 * Pure: no I/O, unit-testable without a browser or a database (PR3).
 */
export function projectQuestion(
  questionId: QuestionId,
  comparison: {
    answers: readonly ComparisonAnswerAnonymised[];
    divergence: DivergenceResult;
  },
): ProjectionQuestion {
  const category = comparison.divergence.category;
  const definition = QUESTION_MAP[questionId];
  return {
    questionId,
    section: definition.section,
    text: definition.text,
    badge:
      category !== null
        ? { category, label: divergenceBadgeLabel(category) as string }
        : null,
    answers: comparison.answers.map((a) => ({
      text: comparisonAnswerText(questionId, a.value, true),
      confidence: a.confidence,
    })),
  };
}