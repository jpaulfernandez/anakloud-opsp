import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import { listPublicAnswersForQuestion } from "./answers";
import {
  classifyDivergence,
  type DivergenceAnswerInput,
  type DivergenceResult,
} from "./divergence";
import { QUESTIONS, type QuestionId } from "./questions";

// The contamination audit (F13-T06, spec.md FR-20, tech_infrastructure.md §3).
//
// FR-20 exists because the coach is the one place a design principle can fail
// silently: a coach that offers its example to everyone homogenises the six
// answers, and the harmonised baseline looks indistinguishable from genuine
// agreement — the guard-trip counter catches a *domain* leak, but a coach that
// quietly nudges toward the same shape leaves no trip to count. §3 makes
// `ai_interactions` the audit: `example_shown` records who saw the common
// example and `answer_changed` records whether they then edited.
//
// This module answers FR-20's question with the deterministic divergence
// scoring from F10-T01 (FR-31), never a model: for each coachable question,
// partition the cohort's final answers into three treatment groups — those
// shown an example, those given a hint only, and those never coached — and run
// `classifyDivergence` on each group. The comparable figure is the mean
// agreement rate across the coachable *closed* questions per group: if the
// example-shown group sits clearly above the uncoached group, the coach has
// pushed answers together and the prompt needs tightening regardless of what
// the guard-trip count says.
//
// The audit is deliberately query-layer clean: answers come through
// `listPublicAnswersForQuestion` (private rows excluded in the SQL, F01-T03)
// and no application log or answer text is written anywhere here. It is a read
// only — the facilitator runs it, it cannot change cohort state.

/** The three treatment buckets FR-20 distinguishes. */
export type ContaminationGroup = "example-shown" | "hint-only" | "uncoached";

/** Stable order for rendering and looping: the coached first, uncoached last. */
export const CONTAMINATION_GROUPS: readonly ContaminationGroup[] = [
  "example-shown",
  "hint-only",
  "uncoached",
];

/**
 * The questions the coach can evaluate (spec.md §6.3 / FR-21). Non-coachable
 * questions are never coached, so every one of their answers would sit in the
 * uncoached bucket and only dilute the comparison. Restricting the audit to
 * the coachable set keeps the three buckets apples-to-apples on the same
 * questions.
 */
export const COACHABLE_QUESTION_IDS: readonly QuestionId[] = QUESTIONS.filter(
  (q) => q.coachable,
).map((q) => q.id);

/** One answer in the audit's input, shaped for the divergence scorer. */
export interface AuditAnswer {
  respondentId: string;
  questionId: QuestionId;
  value: unknown;
  confidence: number | null;
}

/** The deterministic divergence of one treatment group on one question. */
export interface ContaminationGroupResult {
  group: ContaminationGroup;
  /** How many non-private answers of this question landed in this bucket. */
  included: number;
  divergence: DivergenceResult;
}

/** One coachable question, split into its three treatment groups. */
export interface ContaminationQuestionRow {
  questionId: QuestionId;
  groups: Record<ContaminationGroup, ContaminationGroupResult>;
}

/** The whole audit for one cohort, keyed on nothing but that cohort. */
export interface ContaminationAudit {
  /** The cohort this audit was computed for; runnable against any historical one. */
  cohortId: string;
  /** One row per coachable question that has at least one answer in the cohort. */
  questions: ContaminationQuestionRow[];
  /**
   * The comparable headline: mean agreement rate (0..1, higher = more
   * converged) over the coachable closed questions, per group. `null` when no
   * closed question produced a figure for that group.
   */
  agreement: Record<ContaminationGroup, number | null>;
  /** How many coachable closed questions fed the agreement means. */
  closedQuestions: number;
}

/**
 * The pure audit computation (F13-T06). Takes every coachable answer in the
 * cohort and a `groupOf` lookup that maps a (question, respondent) pair to its
 * treatment group, partitions them, and runs the deterministic divergence
 * scorer on each bucket. `groupOf` defaults to uncoached — so a caller with
 * only answers (no interaction log) still gets a meaningful all-uncoached
 * baseline. Private rows never reach here: the answers are public by
 * construction (listPublicAnswersForQuestion filters them in the SQL).
 *
 * Kept pure and free of I/O so the grouping and the rollup are unit-testable
 * without a database, exactly like lib/divergence and lib/validators.
 */
export function computeContaminationAudit(
  cohortId: string,
  answers: readonly AuditAnswer[],
  groupOf: (
    questionId: QuestionId,
    respondentId: string,
  ) => ContaminationGroup = () => "uncoached",
): ContaminationAudit {
  const agreementRates: Record<ContaminationGroup, number[]> = {
    "example-shown": [],
    "hint-only": [],
    uncoached: [],
  };
  const questions: ContaminationQuestionRow[] = [];
  const closedContributing = new Set<string>();

  for (const questionId of COACHABLE_QUESTION_IDS) {
    const questionAnswers = answers.filter((a) => a.questionId === questionId);
    if (questionAnswers.length === 0) continue;

    const groups = {} as Record<ContaminationGroup, ContaminationGroupResult>;
    let contributedAgreement = false;
    for (const group of CONTAMINATION_GROUPS) {
      const subset = questionAnswers.filter(
        (a) => groupOf(questionId, a.respondentId) === group,
      );
      const divergence = classifyDivergence(
        questionId,
        subset.map(
          (a): DivergenceAnswerInput => ({
            value: a.value,
            confidence: a.confidence,
            // Public answers only — private rows were excluded at the query layer.
            is_private: false,
          }),
        ),
      );
      groups[group] = { group, included: subset.length, divergence };
      // An agreement rate only exists for closed questions with ≥1 answer, so
      // open-text (manual-review) questions feed nothing into the rollup.
      if (divergence.agreementRate !== null && subset.length > 0) {
        agreementRates[group].push(divergence.agreementRate);
        contributedAgreement = true;
      }
    }
    questions.push({ questionId, groups });
    if (contributedAgreement) closedContributing.add(questionId);
  }

  const agreement = {} as Record<ContaminationGroup, number | null>;
  for (const group of CONTAMINATION_GROUPS) {
    const rates = agreementRates[group];
    agreement[group] =
      rates.length === 0
        ? null
        : rates.reduce((sum, r) => sum + r, 0) / rates.length;
  }

  return { cohortId, questions, agreement, closedQuestions: closedContributing.size };
}

/**
 * Fetch the audit for one cohort, runnable against any historical cohort that
 * still exists. `actorRespondentId` is the submitted facilitator from the
 * already-passed admin gate (F09-T01); their RLS context is what makes the
 * cohort-wide answers visible. `ai_interactions` is not RLS-gated, so the
 * treatment lookup is read inside the same transaction. Private rows are
 * excluded in SQL by listPublicAnswersForQuestion (F01-T03), so a q14d note
 * never reaches the audit even on the facilitator's read path.
 */
export async function fetchContaminationAudit(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
): Promise<ContaminationAudit> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    // Per (respondent, question) whether any coach nudge showed an example.
    const { rows: coachRows } = await tx.query<{
      respondent_id: string;
      question_id: string;
      example_shown: boolean;
    }>(
      `select aii.respondent_id, aii.question_id, bool_or(aii.example_shown) as example_shown
         from ai_interactions aii
         join respondents r on r.id = aii.respondent_id
        where r.cohort_id = $1 and aii.purpose = 'coach'
        group by aii.respondent_id, aii.question_id`,
      [cohortId],
    );

    const groupMap = new Map<string, ContaminationGroup>();
    for (const row of coachRows) {
      groupMap.set(
        `${row.question_id}:${row.respondent_id}`,
        row.example_shown ? "example-shown" : "hint-only",
      );
    }

    const answers: AuditAnswer[] = [];
    for (const questionId of COACHABLE_QUESTION_IDS) {
      const rows = await listPublicAnswersForQuestion(tx, cohortId, questionId);
      for (const row of rows) {
        answers.push({
          respondentId: row.respondent_id,
          questionId,
          value: row.value,
          confidence: row.confidence,
        });
      }
    }

    return computeContaminationAudit(cohortId, answers, (questionId, respondentId) =>
      groupMap.get(`${questionId}:${respondentId}`) ?? "uncoached",
    );
  });
}