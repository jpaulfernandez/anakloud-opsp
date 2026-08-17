"use client";

import { useMemo, useRef, useState } from "react";
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
import { validators } from "@/lib/validators";
import { STATIC_HINTS, type ValidatedQuestionId } from "@/lib/static-hints";
import { longTextIsAnswered } from "@/lib/long-text";
import { sentenceCompletionIsAnswered } from "@/lib/sentence-completion";
import {
  metricTripleIsAnswered,
  type MetricTripleDraft,
} from "@/lib/metric-triple";
import {
  coachActiveAtLevel,
  type ResolvedLevel,
} from "@/lib/levels";
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
import { CoachCard } from "./CoachCard";

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

// F05-T04 coach state, held per question mount. `nudge` is the honest attempt
// counter ("nudge 2 of 3", FR-17); `closed` is the state after the third nudge
// is dismissed, when the card collapses to the closing line and the coach never
// returns (ui_ux §5.2).
type CoachUI =
  | { kind: "nudge"; nudge: number; hint: string; example?: string }
  | { kind: "closed" };

// The "the coach gave up on this question" flag (FR-17: "then it steps aside
// permanently for that question"), kept at module scope for the life of the
// client session. Component state would be lost on navigation, and navigating
// away and back must not resurrect a coach that already retired.
const retiredCoach = new Set<QuestionId>();

/** Deep equality for the storable answer values the coach compares, so an
    unchanged answer on one screen is recognised as a keep-it-as-is (the second
    tap advances, ui_ux §5.2). */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function QuestionShell({
  question,
  neighbors,
  poolSeed,
  roster = [],
  level,
  returnToReview = false,
}: {
  question: QuestionDefinition;
  neighbors: QuestionNeighbors;
  /** Per-respondent seed for Q8's deterministic pool shuffle (F03-T07). */
  poolSeed: string;
  /** The cohort roster minus the respondent, pre-filling Q14's (b) rows. */
  roster: readonly CohortMember[];
  /** The served degradation level (F05-T06). At L3 the coach is switched off
      entirely and the questionnaire becomes a plain form (spec.md §7).
      Resolved server-side by the pin; this prop is the whole of the
      respondent's exposure to it. */
  level: ResolvedLevel;
  /** True when the respondent reached this screen by editing from the review
      screen (F06-T01). Navigation then loops back to /review instead of
      advancing to the next question, and Back returns to review too — the
      requirement is "returns to that question and back to the review screen",
      never onwards through the form. */
  returnToReview?: boolean;
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

  // F05-T04 nudge state machine. `coachUI` is what sits in the §4.3 coach slot
  // right now; `shownNudges` counts the needs_work cards shown so far this
  // question (capped at 3); `lastEvaluated` is the value the last evaluation
  // ran on so an unchanged answer advances instead of being re-nudged
  // (ui_ux §5.2); `inputSlotRef` lets the shell hand focus back to the field
  // when the card appears, because the card must never take focus away (D2).
  const [coachUI, setCoachUI] = useState<CoachUI | null>(null);
  const [shownNudges, setShownNudges] = useState(0);
  const lastEvaluatedRef = useRef<unknown>(undefined);
  const inputSlotRef = useRef<HTMLElement | null>(null);

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
  const { saveState, flush, offline, lockConflict } = useAutosave({
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
  // F06-T01: navigation is review-bound when the respondent arrived by editing
  // from /review. The normal Continue+coach path runs only for genuine forward
  // movement; any review-bound screen (including the natural end of the form)
  // routes to /review instead, so Back also points there.
  const showNormalContinue = !!next && !returnToReview;
  const backHref = returnToReview ? "/review" : prev ? `/q/${questionRouteSegment(prev)}` : null;
  const reviewButtonLabel = next ? "Continue" : returnToReview ? "Back to review" : "Review your answers";

  // ───────────────────────────────────────────────────────────────────────────
  // F05-T04 coach shell. The coach nudges, it never gates (PR4); no verdict can
  // leave Continue unavailable, because the Continue handler always ends in a
  // navigation or a rendered refusal, never a disabled button. The card lives
  // in the §4.3 coach slot directly below the field (D2) and the whole
  // evaluation is synchronous local computation (the deterministic sibling,
  // PR3) — there is no AI and no network in this path.
  // ───────────────────────────────────────────────────────────────────────────

  function advance() {
    // F04-T02: flush any pending save so a keystroke typed within the debounce
    // window is on the wire before the transition. Not awaited — a failing save
    // must never hold up navigation.
    flush();
    router.push(`/q/${questionRouteSegment(next!)}`);
  }

  function handleReview() {
    // The review entry point (F06-T01): flushes the current draft the same way
    // advance does, then goes to /review. This is what the last question's
    // "Review your answers" button and every return-from-review Continue use,
    // because the review must show the freshly-typed answer.
    flush();
    router.push("/review");
  }

  function focusAnswerField() {
    const slot = inputSlotRef.current;
    if (!slot) return;
    const control = slot.querySelector<HTMLElement>(
      // Prefer the field that carries the answer text; radios/checkboxes in the
      // same slot are not where typing resumes.
      "textarea:not([disabled]), input:not([disabled]):not([type='hidden']):not([type='radio']):not([type='checkbox'])",
    );
    control?.focus();
  }

  // F05-T05 interaction logging. Fire-and-forget on purpose: a failed
  // interaction POST must never disturb the questionnaire (PR4 — the coach
  // nudges but never gates, and its unaudited telemetry is even lighter weight
  // than a nudge). Only coach content is sent — question id, attempt number,
  // verdict and the static hint — never answer text, so "no answer text in
  // application logs" holds even on this the only coach-content write path.
  function logInteraction(body: Record<string, unknown>) {
    void fetch("/api/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => {
      // A dropped log (e.g. a network failure) is not a respondent-faced
      // event; the nudge already rendered and the session is unaffected.
      return;
    });
  }

  function handleShowExample() {
    // Requested against the nudge currently on screen; the server flips
    // example_shown on that nudge's row (F05-T05).
    logInteraction({ kind: "example", question_id: question.id });
  }

  function handleContinue() {
    // Always keep the button live: a refusal is the line rendered from
    // `blockedReason` below, never a disabled control (F03-T01).
    if (!canContinue) return;
    if (!next) return;

    // At L3 (plain-form mode) every answer is accepted without evaluation and
    // the coach never runs (F05-T06, spec.md §7) — the questionnaire advances
    // exactly as if it had been designed without a coach, with nothing to
    // nudge past (PR6, ui_ux D3).
    if (!coachActiveAtLevel(level)) {
      advance();
      return;
    }

    // Non-coachable questions and questions the coach already retired on
    // advance straight through with no evaluation (FR-21, FR-17).
    if (!question.coachable || retiredCoach.has(question.id)) {
      advance();
      return;
    }

    const value = storableAnswerValue(question.id, currentDraft);
    // An answered coachable draft that cannot yet form a stored shape is Q10
    // "not sure yet" — the one case where an answer is complete but has nothing
    // to number or date. That is a full, honest answer and must not be nudged
    // (F05-T01 note), so it advances silently like any passing answer.
    if (value === null || value === undefined) {
      advance();
      return;
    }

    // The coach never re-evaluates an unchanged answer (ui_ux §5.2): Continue
    // on the exact text it just judged is the respondent keeping it as is, so
    // the second tap advances. On the ceiling this also retires the coach.
    if (valuesEqual(lastEvaluatedRef.current, value)) {
      if (shownNudges >= 3) retiredCoach.add(question.id);
      advance();
      return;
    }

    const verdict = validators[question.id](value);
    if (verdict.ok) {
      // A passing answer produces no visible coach output at all (FR-16 note,
      // ui_ux §5.3) — silence on success is what keeps the nudges meaningful.
      setCoachUI(null);
      advance();
      return;
    }

    // Every coachable question carries a §7.1 validator and therefore a static
    // hint (F05-T02); the coachable set is a subset of the validated set.
    const staticHint = STATIC_HINTS[question.id as ValidatedQuestionId];
    const hint = staticHint.hint;
    const example = staticHint.example;
    lastEvaluatedRef.current = value;

    if (shownNudges >= 3) {
      // The ceiling was reached and the answer still fails. The coach gives up
      // rather than showing a fourth nudge: the card collapses to the closing
      // line and it never reopens for this question (FR-17, ui_ux §5.2).
      retiredCoach.add(question.id);
      setCoachUI({ kind: "closed" });
      focusAnswerField();
      return;
    }

    const nudge = shownNudges + 1;
    setShownNudges(nudge);
    setCoachUI({ kind: "nudge", nudge, hint, example });
    // Log the nudge as one interaction row (F05-T05, FR-20): the attempt
    // number, the needs_work verdict and the hint text, at the deterministic
    // L2 level, before focus returns to the field.
    logInteraction({
      kind: "coach",
      question_id: question.id,
      attempt_no: nudge,
      verdict: "needs_work",
      hint_text: hint,
    });
    // The card must not take focus from the field (D2); return focus to the
    // answer so the respondent can revise in place (acceptance criterion).
    focusAnswerField();
  }

  function handleRevise() {
    if (shownNudges >= 3) {
      // Dismissing the third nudge retires the coach permanently for this
      // question: the card is replaced by the closing line (ui_ux §5.2).
      retiredCoach.add(question.id);
      setCoachUI({ kind: "closed" });
    } else {
      setCoachUI(null);
    }
    focusAnswerField();
  }

  function handleKeepAsIs() {
    // Keeping it as is on the ceiling counts as dismissing the third nudge —
    // retire so Back cannot resurrect the coach for this question.
    if (shownNudges >= 3) retiredCoach.add(question.id);
    advance();
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-12 pt-6 sm:px-6 sm:pb-16 text-base">
      <ProgressHeader absolute={neighbors.absolute} current={neighbors.index} />

      <div className="mt-6 mb-1">
        <span className="inline-flex items-center rounded-md bg-cobalt-50 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
          Section: {question.section}
        </span>
      </div>
      <h1 className="mt-1 text-[22px] leading-tight font-bold tracking-tight text-neutral-900 md:text-[28px]">
        {question.text}
      </h1>
      <p className="mt-2 text-base leading-relaxed text-neutral-600">
        {question.helper}
      </p>

      {/* The four §4.3 slots, in order: input, coach, confidence, save. */}
      {/* The input slot carries a ref so the coach can return focus to the field
          when its card appears (D2: the card never takes focus away). */}
      <section
        ref={inputSlotRef}
        aria-label="Answer"
        data-slot="input"
        className="mt-6"
      >
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

      {/* The four §4.3 slots, in order: input, coach, confidence, save. The
        coach slot is omitted entirely at L3 (F05-T06): a plain form is one
        without a coach, and an empty region labelled "Coach" would be a
        reference to a feature that is deliberately absent (PR6, ui_ux D3). */}
      {coachActiveAtLevel(level) && (
        <section
          aria-label="Coach"
          aria-live="polite"
          data-slot="coach"
          className="mt-6"
        >
          {coachUI?.kind === "nudge" && (
            <CoachCard
              // Re-mount per nudge so an example that was opened on a previous
              // nudge collapses when the card re-appears for the new one.
              key={coachUI.nudge}
              hint={coachUI.hint}
              example={coachUI.example}
              nudge={coachUI.nudge}
              onRevise={handleRevise}
              onShowExample={handleShowExample}
              onKeepAsIs={handleKeepAsIs}
            />
          )}
          {coachUI?.kind === "closed" && (
            <p data-testid="coach-closed" className="text-sm font-medium text-neutral-600">
              Fair enough — going with yours.
            </p>
          )}
        </section>
      )}

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
        <SaveStatus state={saveState} offline={offline} />
        {lockConflict?.locked && lockConflict.preserve != null && (
          <LockConflictNotice text={formatReadonlyValue(lockConflict.preserve)} />
        )}
      </section>

      <nav className="mt-10 flex items-center justify-between gap-4 border-t border-neutral-100 pt-6">
        {backHref ? (
          <a
            href={backHref}
            className="inline-flex min-h-[44px] items-center text-sm font-semibold text-neutral-600 transition-colors hover:text-neutral-900"
          >
            ← Back
          </a>
        ) : (
          <span />
        )}

        {showNormalContinue ? (
          <div className="flex flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                // Always keep the button live: a refusal is the line rendered
                // from `blockedReason`, never a disabled control (F03-T01), and
                // no coach verdict can make Continue unavailable (PR4) — the
                // coach logic runs entirely inside handleContinue.
                handleContinue();
              }}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
            >
              Continue
            </button>
            {blockedReason && (
              <p className="text-xs font-medium text-neutral-500">{blockedReason}</p>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleReview}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
          >
            {reviewButtonLabel}
          </button>
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
      className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-4"
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
            className={`h-2.5 w-2.5 shrink-0 rounded-full transition-all ${
              i === current
                ? "bg-cobalt-600 ring-2 ring-cobalt-200 scale-110"
                : i < current
                ? "bg-neutral-800"
                : "bg-neutral-200"
            }`}
          />
        ))}
      </div>
      <span className="text-xs font-semibold tabular-nums text-neutral-500">
        {absolute} of {QUESTION_IDS.length}
      </span>
    </header>
  );
}

/** The persistent save slot (F04-T02, FR-7, ui_ux.md §6): "Saving…" while in
    flight, "✓ Saved" once settled, nothing until the first save is needed. It
    sits in the fixed §4.3 slot between the confidence control and the nav — it
    is never a toast or anything that fades, and "✓ Saved" stays for as long as
    the state is settled. While the browser is offline the slot says the
    verbatim §6 reassurance line instead of a save verdict — a positive promise
    that answers are held on the device and will sync, not an error (F04-T03).
    A lock conflict overrides both: the server won, so the slot states the
    lock plainly rather than pretending a save or a sync is pending (F04-T04). */
function SaveStatus({ state, offline }: { state: SaveState | null; offline: boolean }) {
  if (state === "locked") {
    return (
      <p
        data-testid="save-status"
        aria-live="polite"
        className="text-xs font-medium text-neutral-500"
      >
        Locked
      </p>
    );
  }
  if (offline) {
    return (
      <p
        data-testid="save-status"
        aria-live="polite"
        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900"
      >
        Saved on this device — will sync when you&#39;re back online.
      </p>
    );
  }
  if (state === null) return null;
  return (
    <p
      data-testid="save-status"
      aria-live="polite"
      className={`text-xs font-semibold ${
        state === "saving" ? "text-cobalt-600" : "text-neutral-500"
      }`}
    >
      {state === "saving" ? "Saving…" : "✓ Saved"}
    </p>
  );
}

/** The F04-T04 read-only surface. The respondent typed text that the server
    refused because the answer was already locked (submission happened in
    another tab). Feedback §6: server wins on lock, but typed text is never
    discarded silently — so the text is shown here, read-only, so the person
    can see it is not lost. Deliberately plain copy: this is a bent state being
    named, not a survey congratulation. */
function LockConflictNotice({ text }: { text: string }) {
  return (
    <div
      data-testid="lock-conflict"
      role="status"
      className="mt-4 rounded-md border border-neutral-300 bg-neutral-50 p-4"
    >
      <h2 className="text-base font-semibold text-neutral-900">
        Locked — your answers were already submitted.
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-neutral-600">
        What you typed here couldn&#39;t be saved, so it&#39;s kept visible below
        rather than lost.
      </p>
      <pre
        data-testid="lock-conflict-text"
        className="mt-3 whitespace-pre-wrap rounded bg-white p-3 text-sm text-neutral-800"
      >
        {text}
      </pre>
    </div>
  );
}

/** Faithful read-only rendering of an unsaved answer value. Most §3.1 shapes
    are objects; a composite answer falls back to its serialized form so no
    part of the typed text disappears from the read-only surface. */
function formatReadonlyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}