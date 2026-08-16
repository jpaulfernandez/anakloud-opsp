"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CAPPED_SHORT_TEXT_QUESTION_IDS,
  LONG_TEXT_QUESTION_IDS,
  MATRIX_GRID_QUESTION_IDS,
  METRIC_TRIPLE_QUESTION_IDS,
  PAIRED_ROWS_QUESTION_IDS,
  Q14_QUESTION_IDS,
  Q9_QUESTION_IDS,
  Q10_QUESTION_IDS,
  QUESTION_IDS,
  RANKING_QUESTION_IDS,
  SENTENCE_COMPLETION_QUESTION_IDS,
  SINGLE_CHOICE_REASON_QUESTION_IDS,
  isCappedShortTextQuestion,
  isLongTextQuestion,
  isMatrixGridQuestion,
  isMetricTripleQuestion,
  isPairedRowsQuestion,
  isQ14Question,
  isQ9Question,
  isQ10Question,
  isRankingQuestion,
  isSentenceCompletionQuestion,
  isSingleChoiceReasonQuestion,
  type CappedShortTextQuestionId,
  type CappedShortTextValue,
  type LongTextQuestionId,
  type LongTextValue,
  type MatrixGridQuestionId,
  type MetricTripleQuestionId,
  type PairedRowsQuestionId,
  type Q14QuestionId,
  type Q5Value,
  type Q9QuestionId,
  type Q9ValueType,
  type Q10QuestionId,
  type QuestionDefinition,
  type QuestionId,
  type RankingQuestionId,
  type SentenceCompletionQuestionId,
  type SentenceCompletionValue,
  type SingleChoiceReasonQuestionId,
} from "@/lib/questions";
import type { CohortMember } from "@/lib/cohort";
import {
  canAdvance,
  questionRouteSegment,
  type QuestionNeighbors,
} from "@/lib/navigation";
import { useAutosave, type SaveState } from "@/lib/use-autosave";
import { storableAnswerValue } from "@/lib/to-stored-value";
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
import { type RankingDraft, rankingIsAnswered } from "@/lib/ranking";
import {
  type PairedRowsDraft,
  pairedRowsIsAnswered,
} from "@/lib/paired-rows";
import { type Q14Draft, q14IsAnswered } from "@/lib/q14";
import { q9IsAnswered } from "@/lib/q9";
import {
  SHORT_TEXT_CAPS,
  shortTextIsAnswered,
} from "@/lib/short-text";
import { type Q10Draft, q10IsAnswered } from "@/lib/q10";
import {
  CONFIDENCE_REQUIRED_MESSAGE,
  confidenceIsSet,
  isConfidenceQuestion,
  type ConfidenceQuestionId,
} from "@/lib/confidence";
import { LongTextInput } from "./LongTextInput";
import { SentenceCompletionInput } from "./SentenceCompletionInput";
import { MetricTripleInput } from "./MetricTripleInput";
import { MatrixGridInput } from "./MatrixGridInput";
import { SingleChoiceReasonInput } from "./SingleChoiceReasonInput";
import { RankingInput } from "./RankingInput";
import { PairedRowsInput } from "./PairedRowsInput";
import { Q14Input } from "./Q14Input";
import { ShortTextInput } from "./ShortTextInput";
import { Q9Input } from "./Q9Input";
import { Q10Input } from "./Q10Input";
import { ConfidenceSlider } from "./ConfidenceSlider";

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
type RankingDrafts = Partial<Record<RankingQuestionId, RankingDraft>>;
type PairedRowsDrafts = Partial<Record<PairedRowsQuestionId, PairedRowsDraft>>;
type Q14Drafts = Partial<Record<Q14QuestionId, Q14Draft>>;
type CappedShortTextAnswers = Partial<
  Record<CappedShortTextQuestionId, CappedShortTextValue>
>;
type Q9Drafts = Partial<Record<Q9QuestionId, Q9ValueType>>;
type Q10Drafts = Partial<Record<Q10QuestionId, Q10Draft>>;
type ConfidenceAnswers = Partial<Record<ConfidenceQuestionId, number>>;

export function QuestionShell({
  question,
  neighbors,
  poolSeed,
  roster = [],
}: {
  question: QuestionDefinition;
  neighbors: QuestionNeighbors;
  /** Per-respondent seed for Q8's deterministic pool shuffle (F03-T07). */
  poolSeed: string;
  /** The cohort roster minus the respondent, pre-filling Q14's (b) rows. */
  roster: readonly CohortMember[];
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
  const [rankedDrafts, setRankedDrafts] = useState<RankingDrafts>({});
  const [pairedRowsDrafts, setPairedRowsDrafts] = useState<PairedRowsDrafts>({});
  const [q14Drafts, setQ14Drafts] = useState<Q14Drafts>({});
  const [shortTextAnswers, setShortTextAnswers] =
    useState<CappedShortTextAnswers>({});
  const [q9Drafts, setQ9Drafts] = useState<Q9Drafts>({});
  const [q10Drafts, setQ10Drafts] = useState<Q10Drafts>({});
  // The FR-11 confidence rings. Each question's shell holds its own value for
  // the current screen (like every other draft — there is no cross-page
  // persistence until F04); the F04 ticket writes it to the `answers.confidence`
  // column. Held separately from the input drafts because §3.1 keeps confidence
  // in its own smallint column, not inside the question's `value` jsonb.
  const [confidenceAnswers, setConfidenceAnswers] = useState<ConfidenceAnswers>(
    {},
  );

  // F04-T02 autosave. One question per screen, so the only answer that can
  // change is the current one; this reads that one draft out of whichever slice
  // the rendered input populates, and the autosave hook persists it (debounced)
  // for as long as it is a storable §3.1 shape. `storableAnswerValue` handles
  // the two composite questions whose drafts differ from the stored shape (Q10,
  // Q14); the rest pass through and the hook's shape guard decides.
  const currentDraft: unknown = useMemo(() => {
    const id = question.id;
    if (isLongTextQuestion(id)) return longTextAnswers[id];
    if (isSentenceCompletionQuestion(id)) return sentenceAnswers[id];
    if (isMetricTripleQuestion(id)) return metricTripleDrafts[id];
    if (isMatrixGridQuestion(id)) return matrixGridDrafts[id];
    if (isSingleChoiceReasonQuestion(id)) return singleChoiceReasonDrafts[id];
    if (isRankingQuestion(id)) return rankedDrafts[id];
    if (isPairedRowsQuestion(id)) return pairedRowsDrafts[id];
    if (isQ14Question(id)) return q14Drafts[id];
    if (isCappedShortTextQuestion(id)) return shortTextAnswers[id];
    if (isQ9Question(id)) return q9Drafts[id];
    if (isQ10Question(id)) return q10Drafts[id];
    return undefined;
  }, [
    question.id,
    longTextAnswers,
    sentenceAnswers,
    metricTripleDrafts,
    matrixGridDrafts,
    singleChoiceReasonDrafts,
    rankedDrafts,
    pairedRowsDrafts,
    q14Drafts,
    shortTextAnswers,
    q9Drafts,
    q10Drafts,
  ]);
  const { saveState, flush } = useAutosave({
    questionId: question.id,
    value: storableAnswerValue(question.id, currentDraft),
    confidence: isConfidenceQuestion(question.id)
      ? (confidenceAnswers[question.id] ?? null)
      : null,
  });

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
    for (const id of RANKING_QUESTION_IDS) {
      const draft = rankedDrafts[id];
      if (draft && rankingIsAnswered(draft)) set.add(id);
    }
    for (const id of PAIRED_ROWS_QUESTION_IDS) {
      const draft = pairedRowsDrafts[id];
      if (draft && pairedRowsIsAnswered(draft)) set.add(id);
    }
    for (const id of Q14_QUESTION_IDS) {
      const draft = q14Drafts[id];
      if (draft && q14IsAnswered(draft)) set.add(id);
    }
    for (const id of CAPPED_SHORT_TEXT_QUESTION_IDS) {
      const value = shortTextAnswers[id];
      if (value && shortTextIsAnswered(value)) set.add(id);
    }
    for (const id of Q9_QUESTION_IDS) {
      const draft = q9Drafts[id];
      if (draft && q9IsAnswered(draft)) set.add(id);
    }
    for (const id of Q10_QUESTION_IDS) {
      const draft = q10Drafts[id];
      if (draft && q10IsAnswered(draft)) set.add(id);
    }
    return set;
  }, [
    longTextAnswers,
    sentenceAnswers,
    metricTripleDrafts,
    matrixGridDrafts,
    singleChoiceReasonDrafts,
    rankedDrafts,
    pairedRowsDrafts,
    q14Drafts,
    shortTextAnswers,
    q9Drafts,
    q10Drafts,
  ]);

  const inputBlocked = canAdvance(question.id, answered);
  // FR-11: the six confidence questions also require a ring before continuing.
  // `confidence` is not part of the input `answered` set (it lives in its own
  // column), so the shell gates it separately the same way it special-cases
  // Q6's required reason.
  const confidenceValue = isConfidenceQuestion(question.id)
    ? confidenceAnswers[question.id] ?? null
    : null;
  const confidenceMissing =
    question.confidence && !confidenceIsSet(confidenceValue);
  const canContinue = inputBlocked.kind === "advance" && !confidenceMissing;
  // Q6's required half is the reason: a blocked Continue there says so in the
  // specific words §4.9 names instead of the shell's generic unanswered line.
  // A confidence question whose input is complete but whose ring is unset gets
  // its own line telling the respondent what is missing (F03-T11 acceptance:
  // refused "with an explanation").
  const blockedReason =
    inputBlocked.kind === "blocked"
      ? isSingleChoiceReasonQuestion(question.id)
        ? SINGLE_CHOICE_REASON_BLOCKED_MESSAGE
        : inputBlocked.reason
      : confidenceMissing
        ? CONFIDENCE_REQUIRED_MESSAGE
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
        {isRankingQuestion(question.id) && (
          <RankingInput
            value={rankedDrafts[question.id]}
            seed={poolSeed}
            onChange={(next) =>
              setRankedDrafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isPairedRowsQuestion(question.id) && (
          <PairedRowsInput
            value={pairedRowsDrafts[question.id]}
            onChange={(next) =>
              setPairedRowsDrafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isQ14Question(question.id) && (
          <Q14Input
            value={q14Drafts[question.id]}
            teammates={roster}
            onChange={(next) =>
              setQ14Drafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isCappedShortTextQuestion(question.id) && (
          <ShortTextInput
            cap={SHORT_TEXT_CAPS[question.id]}
            value={shortTextAnswers[question.id]}
            inputId={question.id}
            onChange={(next) =>
              setShortTextAnswers((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isQ9Question(question.id) && (
          <Q9Input
            value={q9Drafts[question.id]}
            onChange={(next) =>
              setQ9Drafts((current) => ({
                ...current,
                [question.id]: next,
              }))
            }
          />
        )}
        {isQ10Question(question.id) && (
          <Q10Input
            value={q10Drafts[question.id]}
            onChange={(next) =>
              setQ10Drafts((current) => ({
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
        >
          {isConfidenceQuestion(question.id) && (
            <ConfidenceSlider
              value={confidenceAnswers[question.id] ?? null}
              onChange={(next) =>
                setConfidenceAnswers((current) => ({
                  ...current,
                  [question.id]: next ?? undefined,
                }))
              }
            />
          )}
        </section>
      )}

      <section aria-label="Save status" data-slot="save" className="mt-6">
        <SaveStatus state={saveState} />
      </section>

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
                // from `blockedReason` below, never a disabled control (F03-T01).
                if (canContinue) {
                  // F04-T02: flush any pending save so a keystroke typed within
                  // the debounce window is on the wire before the transition.
                  // Not awaited — a failing save must never hold up navigation.
                  flush();
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

/** The persistent save slot (F04-T02, FR-7, ui_ux.md §6): "Saving…" while in
    flight, "✓ Saved" once settled, nothing until the first save is needed. It
    sits in the fixed §4.3 slot between the confidence control and the nav — it
    is never a toast or anything that fades, and "✓ Saved" stays for as long as
    the state is settled. */
function SaveStatus({ state }: { state: SaveState | null }) {
  if (state === null) return null;
  return (
    <p
      data-testid="save-status"
      aria-live="polite"
      className="text-sm text-neutral-500"
    >
      {state === "saving" ? "Saving…" : "✓ Saved"}
    </p>
  );
}