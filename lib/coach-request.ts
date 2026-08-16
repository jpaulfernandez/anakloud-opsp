import type { ClientBase } from "pg";
import { listPublicAnswers } from "./answers";
import type { CoachRequestContext } from "./coach-prompt";
import { QUESTION_MAP, type QuestionId } from "./questions";
import { formatAnswerSummary } from "./review";

// Coach payload minimisation (F13-T02, tech_infrastructure.md §5.1, §9;
// spec.md §6.2, §8). lib/coach-prompt.ts already builds a request that carries
// only question metadata + one answer, but nothing constrained *which* stored
// answer fed it. This module is that constraint: it resolves the context the
// prompt builder expects from exactly one of a respondent's stored answers.
//
// The read goes through listPublicAnswers — the single public read helper
// (F01-T03) — so private rows are excluded in the SQL, never in a filter step
// someone can forget. The Q14(d) note lives in its own is_private row and can
// therefore never reach any coach payload, even if the note's owning question
// were evaluated. No name, id or email is carried, and no identity or other
// answer is rendered into the payload the prompt builder emits.
//
// Statelessness: the context is resolved fresh from the stored rows on every
// call — nothing is cached or threaded between calls, so consecutive calls see
// exactly one answer each and share no conversational state.

/**
 * Resolve the context a single coach call evaluates: question metadata and the
 * one answer stored for `respondentId`/`questionId`. Runs inside the caller's
 * RLS scope (withRespondentContext); listPublicAnswers is what keeps a private
 * note out of the result no matter which question is asked.
 */
export async function loadCoachRequest(
  db: ClientBase,
  respondentId: string,
  questionId: QuestionId,
  exampleRequested = false,
): Promise<CoachRequestContext> {
  const definition = QUESTION_MAP[questionId];
  const answers = await listPublicAnswers(db, respondentId);
  const row = answers.find((a) => a.question_id === questionId);
  return {
    questionId,
    questionText: definition.text,
    helper: definition.helper,
    // An unanswered (or private-only) question renders as empty text; there is
    // no value to evaluate, which is the honest input for a not-yet-answered
    // advance. formatAnswerSummary is the established pure stored-value→text
    // renderer (shared with review/export/comparison).
    answer: row ? formatAnswerSummary(questionId, row.value) : "",
    exampleRequested,
  };
}