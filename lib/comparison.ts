import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import { listPublicAnswersForQuestion } from "./answers";
import {
  classifyDivergence,
  type DivergenceAnswerInput,
  type DivergenceResult,
} from "./divergence";
import type { QuestionId } from "./questions";

// F10-T02 — the comparison data endpoint's data path (tech_infrastructure.md
// §4: GET /api/admin/question/:qid). Returns every respondent's answer to one
// question plus its deterministic divergence result (FR-31), computed without
// any AI provider.
//
// The anonymised / attributed split is a safety feature, not a preference
// (F10 README, ui_ux.md §4.18). Anonymised is the default and, by
// construction, the anonymised payload carries no name, email or respondent id
// — the answer and its confidence only. Attributed mode is the only shape that
// includes who said it, and it is requested explicitly; it is never entered
// by a single click's worth of accident because the default mode and the
// failure-safe parse of anything ambiguous both land on anonymised.
//
// Private rows (the q14d note) never reach this module: the answer rows come
// through listPublicAnswersForQuestion (lib/answers.ts), which excludes
// `is_private = false` in the SQL — the query-layer guarantee (F01-T03) that
// keeps the note off the comparison screen even on the facilitator's read
// path, whose RLS policy would otherwise expose it.

/** The two response modes. Anonymised is the product's default (F10-T04). */
export type ComparisonMode = "anonymised" | "attributed";

/** The payload the endpoint serves in anonymised mode: data, never identity. */
export interface ComparisonAnswerAnonymised {
  value: unknown;
  confidence: number | null;
}

/** The payload in attributed mode: anonymised fields plus who said it. */
export interface ComparisonAnswerAttributed {
  respondentId: string;
  name: string;
  email: string | null;
  value: unknown;
  confidence: number | null;
}

/** The whole response for one question. */
export interface QuestionComparison {
  questionId: QuestionId;
  mode: ComparisonMode;
  answers: Array<ComparisonAnswerAnonymised | ComparisonAnswerAttributed>;
  divergence: DivergenceResult;
}

/**
 * Parse a `mode` query value. Anything that is not exactly "attributed" —
 * including a missing value, an empty one, or an unknown spelling — is
 * anonymised, so no malformed request can ever serve names by accident.
 */
export function parseComparisonMode(
  raw: string | null | undefined,
): ComparisonMode {
  return raw === "attributed" ? "attributed" : "anonymised";
}

/**
 * Read every respondent's answer to one question in the facilitator's own
 * cohort, plus its deterministic divergence. `actorRespondentId` is the
 * submitted facilitator from the already-passed admin gate (F09-T01); running
 * inside their RLS context is what makes the cohort-wide answers visible
 * (answers_facilitator_read). The answer rows come from the public read helper
 * (private rows excluded in SQL), and the identity map is read from
 * `respondents` alone — so no direct select from `answers` lives outside
 * lib/answers.ts (F01-T03). Ordering follows the helper's deterministic sort,
 * so repeated loads are stable for whatever the screen layer then does.
 */
export async function fetchQuestionComparison(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  questionId: QuestionId,
  mode: ComparisonMode,
): Promise<QuestionComparison> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const answers = await listPublicAnswersForQuestion(tx, cohortId, questionId);

    // Identity only where attributed — but fetched eagerly under the shared
    // transaction and shaped out below, so the anonymised branch never leans
    // on a "remember not to send names" filter.
    const { rows: identityRows } = await tx.query<{
      id: string;
      display_name: string;
      email: string | null;
    }>(
      `select id, display_name, email from respondents where cohort_id = $1`,
      [cohortId],
    );
    const identity = new Map(
      identityRows.map((r) => [r.id, { name: r.display_name, email: r.email }]),
    );

    const divergence = classifyDivergence(
      questionId,
      answers.map(
        (a): DivergenceAnswerInput => ({
          value: a.value,
          confidence: a.confidence,
          // Private rows were already excluded at the query layer.
          is_private: false,
        }),
      ),
    );

    const shaped = answers.map((a) => {
      const who = identity.get(a.respondent_id);
      return mode === "attributed"
        ? {
            respondentId: a.respondent_id,
            name: who?.name ?? "",
            email: who?.email ?? null,
            value: a.value,
            confidence: a.confidence,
          }
        : { value: a.value, confidence: a.confidence };
    });

    return { questionId, mode, answers: shaped, divergence };
  });
}