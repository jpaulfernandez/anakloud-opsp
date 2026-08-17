// Facilitator-analysis payload minimisation (F14-T01, tech_infrastructure.md
// §5.5, spec.md §8). lib/analysis-prompt.ts builds a request that carries only
// question metadata and labelled positions, but nothing constrained *which*
// stored answers fed it, or that identity stayed out. This module is that
// constraint: it resolves the anonymised context the prompt builder expects
// from the cohort's stored answers.
//
// Privacy is decided at the query layer, never in a filter step. The reads go
// through listPublicAnswersForQuestion and listPublicAnswersForCohort (the
// public read helpers from F01-T03), both of which add `is_private = false` in
// the SQL — so the Q14(d) note, which lives in its own private row, can never
// reach any analysis payload, even when Q14 is itself analysed. No name, email
// or respondent id is selected at all; respondents are labelled A, B, C in a
// deterministic order derived only from their ids, so the same person is always
// the same letter across a payload and across calls.
//
// Answer text runs through comparisonAnswerText(..., anonymise = true), the
// same wall-safety formatter as the comparison screen: Q14(b)'s teammate
// respondent ids are redacted to a neutral label, so no respondent identifier
// rides inside an answer value either.
//
// Runs inside the caller's withRespondentContext (the actor is the already-
// passed facilitator from F09-T01), which is what makes cohort-wide answers
// visible under the facilitator's RLS policy. Stateless: the context is
// resolved fresh from the stored rows on every call.

import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import {
  listPublicAnswersForCohort,
  listPublicAnswersForQuestion,
} from "./answers";
import { comparisonAnswerText } from "./comparison-screen";
import { QUESTIONS, type QuestionId } from "./questions";
import type {
  AnalysisQuestionBlock,
  AnalysisRequestContext,
} from "./analysis-prompt";

/**
 * The anonymised respondent labels §5.5 names (A, B, C…). Six labels cover the
 * whole cohort; a cohort cannot have more respondents than invited seats.
 */
const LABELS = ["A", "B", "C", "D", "E", "F"] as const;

/**
 * A stable, identity-free ordering of respondent ids. Sorted by id alone, so
 * the same respondent is always the same letter across blocks and calls, but
 * no id is ever emitted — the letters are all that survive into the payload.
 */
function labelsFor(respondentIds: readonly string[]): Map<string, string> {
  const sorted = [...new Set(respondentIds)].sort();
  const labels = new Map<string, string>();
  sorted.forEach((id, i) => labels.set(id, LABELS[i] ?? "?"));
  return labels;
}

/**
 * Load the anonymised context for a single question: every respondent's answer
 * to `questionId`, labelled A/B/C. Called with the facilitator's respondent id
 * so the cohort-wide read is visible. Private rows are excluded in the SQL.
 */
export async function loadAnalysisForQuestion(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  questionId: QuestionId,
): Promise<AnalysisRequestContext> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const definition = QUESTIONS.find((q) => q.id === questionId)!;
    const answers = await listPublicAnswersForQuestion(tx, cohortId, questionId);
    const labels = labelsFor(answers.map((a) => a.respondent_id));
    const positions = answers.map((a) => ({
      respondent: labels.get(a.respondent_id) ?? "?",
      text: comparisonAnswerText(questionId, a.value, true),
    }));
    const block: AnalysisQuestionBlock = {
      questionId,
      questionText: definition.text,
      positions,
    };
    return { scope: "question", questionId, blocks: [block] };
  });
}

/**
 * Load the anonymised context for the whole cohort: every public answer,
 * grouped per question and labelled A/B/C with a single consistent mapping, so
 * the model can read agreement and disagreement across the questionnaire. A
 * question with no answers is omitted. Private rows are excluded in the SQL.
 */
export async function loadAnalysisForCohort(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
): Promise<AnalysisRequestContext> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const answers = await listPublicAnswersForCohort(tx, cohortId);
    const labels = labelsFor(answers.map((a) => a.respondent_id));

    const blocks: AnalysisQuestionBlock[] = [];
    for (const definition of QUESTIONS) {
      const positions = answers
        .filter((a) => a.question_id === definition.id)
        .map((a) => ({
          respondent: labels.get(a.respondent_id) ?? "?",
          text: comparisonAnswerText(definition.id, a.value, true),
        }));
      if (positions.length === 0) continue;
      blocks.push({
        questionId: definition.id,
        questionText: definition.text,
        positions,
      });
    }

    return { scope: "cohort", questionId: null, blocks };
  });
}