"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LONG_TEXT_QUESTION_IDS,
  MATRIX_GRID_QUESTION_IDS,
  METRIC_TRIPLE_QUESTION_IDS,
  QUESTION_IDS,
  SENTENCE_COMPLETION_QUESTION_IDS,
  SINGLE_CHOICE_REASON_QUESTION_IDS,
  isLongTextQuestion,
  isMatrixGridQuestion,
  isMetricTripleQuestion,
  isSentenceCompletionQuestion,
  isSingleChoiceReasonQuestion,
  type LongTextQuestionId,
  type LongTextValue,
  type MatrixGridQuestionId,
  type MetricTripleQuestionId,
  type Q5Value,
  type QuestionDefinition,
  type QuestionId,
  type SentenceCompletionQuestionId,
  type SentenceCompletionValue,
  type SingleChoiceReasonQuestionId,
} from "@/lib/questions";
import {
  canAdvance,
  questionRouteSegment,
  type QuestionNeighbors,
} from "@/lib/navigation";
import { longTextIsAnswered } from "@/lib/long-text";
import { sentenceCompletionIsAnswered } from "@/lib/sentence-completion";
import {
  metricTripleIsAnswered,
  type MetricTripleDraft,
} from "@/lib/metric-triple";
import { matrixGridIsAnswered } from "@/lib/matrix-grid";
import {
  SINGLE_CHOICE_REASON_BLOCKED_MESSAGE,
  type SingleChoiceReasonDraft,
  singleChoiceReasonIsAnswered,
} from "@/lib/single-choice-reason";
import { LongTextInput } from "./LongTextInput";
import { SentenceCompletionInput } from "./SentenceCompletionInput";
import { MetricTripleInput } from "./MetricTripleInput";
import { MatrixGridInput } from "./MatrixGridInput";
import { SingleChoiceReasonInput } from "./SingleChoiceReasonInput";

// The question shell (F03-T01, FR-6, FR-8, FR-9, ui_ux.md §4.3, D1).
//
// One question per screen, exactly. Nothing here renders a list, index or
// preview of the other fourteen questions (FR-6) — the only awareness of the
// rest of the questionnaire is a row of progress dots, which orients rather
// than letting someone read ahead. The shell owns the frame and the
// navigation; the type-specific inputs ("Answer", "Coach", "Confidence",
// "Save status") are filled by later F03 tickets, so those four slot
// <section>s exist now as empty containers in the §4.3 order — the order is a
// settled decision, not something each input ticket re-arbitrates.
//
// Navigation is FR-8/FR-9: Back always proceeds to the previous question
// within an unsubmitted session; Continue advances only when the current
// required question holds an answer. When it does not, the button stays live
// and explains itself in words rather than simply greying out. Exactly one
// question (Q15) is optional, but the rule is generic — canAdvance decides
// from the registry's `required` flag, never a hardcoded id.
//
// F03-T02 wires the long-text input (Q1, Q13, Q15) into the input slot. The
// shell lifts the answered set so `canAdvance` reflects what the respondent
// has actually typed; the long-text component reports its value up and the
// shell derives "answered" from it (a non-empty answer unblocks Continue). The
// full value is kept in shell state so a later autosave ticket (F04) can read
// it back verbatim, including Q13's `{ text, cause }` pair.

type LongTextAnswers = Partial<Record<LongTextQuestionId, LongTextValue>>;
type SentenceCompletionAnswers = Partial<
  Record<SentenceCompletionQuestionId, SentenceCompletionValue>
>;
type MetricTripleDrafts = Partial<Record<MetricTripleQuestionId, MetricTripleDraft>>;
type MatrixGridDrafts = Partial<Record<MatrixGridQuestionId, Q5Value>>;
type SingleChoiceReasonDrafts = Partial<
  Record<SingleChoiceReasonQuestionId, SingleChoiceReasonDraft>
>;

export function QuestionShell({
  question,
  neighbors,
}: {
  question: QuestionDefinition;
  neighbors: QuestionNeighbors;
}) {
  const router = useRouter();
  const [longTextAnswers, setLongTextAnswers] = useState<LongTextAnswers>({});
  const [sentenceAnswers, setSentenceAnswers] =
    useState<SentenceCompletionAnswers>({});
  const [metricTripleDrafts, setMetricTripleDrafts] =
    useState<MetricTripleDrafts>({});
  const [matrixGridDrafts, setMatrixGridDrafts] = useState<MatrixGridDrafts>({});
  const [singleChoiceReasonDrafts, setSingleChoiceReasonDrafts] =
    useState<SingleChoiceReasonDrafts>({});

  const answered: ReadonlySet<QuestionId> = useMemo(() => {
    const set = new Set<QuestionId>();
    for (const id of LONG_TEXT_QUESTION_IDS) {
      const value = longTextAnswers[id];
      if (value && longTextIsAnswered(value)) set.add(id);
    }
    for (const id of SENTENCE_COMPLETION_QUESTION_IDS) {
      const value = sentenceAnswers[id];
      if (value && sentenceCompletionIsAnswered(value)) set.add(id);
    }
    for (const id of METRIC_TRIPLE_QUESTION_IDS) {
      const draft = metricTripleDrafts[id];
      if (draft && metricTripleIsAnswered(draft)) set.add(id);
    }
    for (const id of MATRIX_GRID_QUESTION_IDS) {
      const value = matrixGridDrafts[id];
      if (value && matrixGridIsAnswered(value)) set.add(id);
    }
    for (const id of SINGLE_CHOICE_REASON_QUESTION_IDS) {
      const draft = singleChoiceReasonDrafts[id];
      if (draft && singleChoiceReasonIsAnswered(draft)) set.add(id);
    }
    return set;
  }, [
    longTextAnswers,
    sentenceAnswers,
    metricTripleDrafts,
    matrixGridDrafts,
    singleChoiceReasonDrafts,
  ]);

  const blocked = canAdvance(question.id, answered);
  // Q6's required half is the reason: a blocked Continue there says so in the
  // specific words §4.9 names instead of the shell's generic unanswered line.
  const blockedReason =
    blocked.kind === "blocked"
      ? isSingleChoiceReasonQuestion(question.id)
        ? SINGLE_CHOICE_REASON_BLOCKED_MESSAGE
        : blocked.reason
      : null;
  const prev = neighbors.prev;
  const next = neighbors.next;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <ProgressHeader absolute={neighbors.absolute} current={neighbors.index} />

      <p className="mt-6 text-sm font-medium text-neutral-500">
        Section: {question.section}
      </p>
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        {question.text}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-neutral-600">
        {question.helper}
      </p>

      {/* The four §4.3 slots, in order: input, coach, confidence, save. */}
      <section aria-label="Answer" data-slot="input" className="mt-6">
        {isLongTextQuestion(question.id) && (
          <LongTextInput
            questionId={question.id}
            value={longTextAnswers[question.id]}
            onChange={(next) =>
              setLongTextAnswers((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isSentenceCompletionQuestion(question.id) && (
          <SentenceCompletionInput
            value={sentenceAnswers[question.id]}
            onChange={(next) =>
              setSentenceAnswers((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isMetricTripleQuestion(question.id) && (
          <MetricTripleInput
            value={metricTripleDrafts[question.id]}
            onChange={(next) =>
              setMetricTripleDrafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isMatrixGridQuestion(question.id) && (
          <MatrixGridInput
            value={matrixGridDrafts[question.id]}
            onChange={(next) =>
              setMatrixGridDrafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isSingleChoiceReasonQuestion(question.id) && (
          <SingleChoiceReasonInput
            value={singleChoiceReasonDrafts[question.id]}
            onChange={(next) =>
              setSingleChoiceReasonDrafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
      </section>

      <section
        aria-label="Coach"
        aria-live="polite"
        data-slot="coach"
        className="mt-6"
      />

      {question.confidence && (
        <section
          aria-label="Confidence"
          data-slot="confidence"
          className="mt-6"
        />
      )}

      <section aria-label="Save status" data-slot="save" className="mt-6" />

      <nav className="mt-10 flex items-center justify-between gap-3">
        {prev ? (
          <a
            href={`/q/${questionRouteSegment(prev)}`}
            className="text-base font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
          >
            ← Back
          </a>
        ) : (
          <span />
        )}

        {next && (
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => {
                // Always keep the button live: a refusal is the line rendered
                // from `blocked` below, never a disabled control (F03-T01).
                if (blocked.kind === "advance") {
                  router.push(`/q/${questionRouteSegment(next)}`);
                }
              }}
              className="rounded-md bg-neutral-900 px-4 py-2 text-base font-semibold text-white hover:bg-neutral-700"
            >
              Continue
            </button>
            {blockedReason && (
              <p className="text-sm text-neutral-600">{blockedReason}</p>
            )}
          </div>
        )}
      </nav>
    </main>
  );
}

/** Discrete progress dots plus an "n of 15" count; never a percentage bar. */
function ProgressHeader({
  absolute,
  current,
}: {
  absolute: number;
  current: number;
}) {
  return (
    <header
      className="flex items-center gap-3"
      aria-label={`Question ${absolute} of ${QUESTION_IDS.length}`}
    >
      <div
        data-testid="progress-dots"
        role="list"
        aria-label={`Progress: question ${absolute} of ${QUESTION_IDS.length}`}
        className="flex flex-nowrap items-center gap-1.5 overflow-hidden"
      >
        {QUESTION_IDS.map((id, i) => (
          <span
            key={id}
            role="listitem"
            data-testid="progress-dot"
            aria-current={i === current ? "step" : undefined}
            className={`h-2 w-2 shrink-0 rounded-full ${
              i === current ? "bg-neutral-900" : "bg-neutral-300"
            }`}
          />
        ))}
      </div>
      <span className="text-sm tabular-nums text-neutral-500">
        {absolute} of {QUESTION_IDS.length}
      </span>
    </header>
  );
}