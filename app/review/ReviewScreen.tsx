"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QUESTION_MAP, type QuestionId } from "@/lib/questions";
import { questionRouteSegment } from "@/lib/navigation";
import { isConfidenceQuestion } from "@/lib/confidence";
import {
  allRequiredQuestionsAnswered,
  formatAnswerSummary,
  skippedOptionalQuestions,
  type DisplayNameResolver,
  type ReviewQuestion,
} from "@/lib/review";

// The review screen (F06-T01, FR-13, ui_ux.md §4.12).
//
// All fifteen questions collapsed to answer summaries, each with an edit link
// that returns to the question and back to review (`/q/[id]?from=review`),
// the skipped optional questions under the verbatim "You skipped these —
// that's allowed." heading, and a submit button that stays secondary-styled
// until every required question is answered. A client component because the
// skip list and the submit-button styling depend on which questions are
// answered, and because the confirmation/submit interaction (F06-T02 on) will
// add client state here.
//
// The answers arrive assembled server-side (buildReviewModel), including the
// respondent's own q14d note, which is rendered here as a distinct inset panel
// because showing the owner their own private field is exactly what this
// screen is for — every exporter still excludes it at the query layer.

export function ReviewScreen({
  questions,
  rosterNames,
  onConfirmSubmit,
}: {
  questions: ReviewQuestion[];
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
  /**
   * Called when the respondent confirms in the submit dialog. F06-T02 is the
   * confirmation itself; the actual `POST /api/submit` transaction is F06-T03.
   * When a page supplies this handler it owns the submit; otherwise the review
   * performs the submit itself (F11-T02 journeys through the real UI).
   */
  onConfirmSubmit?: () => void;
}) {
  const router = useRouter();
  const nameOf: DisplayNameResolver = useCallback(
    (respondentId) => rosterNames[respondentId],
    [rosterNames],
  );
  const answered = useMemo(
    () => new Set<QuestionId>(questions.filter((q) => q.answered).map((q) => q.id)),
    [questions],
  );
  const complete = allRequiredQuestionsAnswered(answered);
  const skipped = skippedOptionalQuestions(answered);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // F06-T03 submit: when the page does not supply an onConfirmSubmit, the
  // review performs POST /api/submit itself and sends the respondent to the
  // submitted view. A failed submit leaves them on the review screen with their
  // answers intact — PR4: nothing about the questionnaire fails.
  function confirmSubmit() {
    setConfirmOpen(false);
    if (onConfirmSubmit) {
      onConfirmSubmit();
      return;
    }
    void fetch("/api/submit", { method: "POST" })
      .then((response) => {
        if (response.ok) router.push("/");
      })
      .catch(() => {
        // Network failure: stay on the review screen with answers intact.
        return;
      });
  }

  // Answered questions (plus any unanswered required, an edge that can only
  // occur by direct navigation) go in the main list; skipped optional ones are
  // collected under their own heading.
  const answeredList = questions.filter((q) => q.answered || q.required);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 text-base">
      <header className="mb-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
          Before you submit
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          Review your answers
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          Everything below is what your answers add up to. Open any question to
          change it before you lock the baseline in.
        </p>
      </header>

      <ol className="space-y-4">
        {answeredList.map((q, idx) => (
          <ReviewCard key={q.id} position={idx + 1} question={q} nameOf={nameOf} />
        ))}
      </ol>

      {skipped.length > 0 && (
        <section aria-label="You skipped these — that's allowed." className="mt-12 rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-6">
          <h2 className="text-base font-bold text-neutral-900">
            You skipped these — that&apos;s allowed.
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            You can leave them as they are or open one to answer it later.
          </p>
          <ul className="mt-4 divide-y divide-neutral-200/60">
            {skipped.map((id) => (
              <li key={id} className="flex items-center justify-between gap-4 py-3">
                <span className="text-sm font-medium text-neutral-800">{QUESTION_MAP[id].text}</span>
                <a
                  href={`/q/${questionRouteSegment(id)}?from=review`}
                  className="shrink-0 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-cobalt-700 hover:text-cobalt-800 bg-cobalt-50 hover:bg-cobalt-100/80 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Answer &rarr;
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex justify-end border-t border-neutral-100 pt-6">
        <button
          type="button"
          data-testid="review-submit"
          onClick={() => setConfirmOpen(true)}
          className={
            complete
              ? "inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
              : "inline-flex min-h-[48px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-6 py-3 text-base font-medium text-neutral-500 shadow-subtle hover:bg-neutral-50"
          }
        >
          Submit and lock
        </button>
      </div>

      {confirmOpen && (
        <SubmitDialog
          onNotYet={() => setConfirmOpen(false)}
          onConfirm={confirmSubmit}
        />
      )}
    </main>
  );
}

// Submit confirmation (F06-T02, FR-14, ui_ux.md §4.13). A real decision point,
// not a rubber stamp: the respondent is told the answers will be locked, that
// this is deliberate, and that the OPSP built from them stays editable. It
// renders verbatim §4.13 copy with `[ Not yet ]` (returns to review, nothing
// changed) and `[ Submit and lock ]` (the single confirmation that can lead to
// a submit). There is no submit path that bypasses this dialog — the review
// screen's button opens it rather than submitting directly.
function SubmitDialog({
  onNotYet,
  onConfirm,
}: {
  onNotYet: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-confirm-title"
      data-testid="submit-confirmation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl sm:p-8">
        <h2
          id="submit-confirm-title"
          className="text-xl font-bold leading-snug text-neutral-900"
        >
          Submitting locks your answers.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          You won&apos;t be able to change them afterwards &mdash; that&apos;s
          deliberate, so the baseline stays a baseline. You&apos;ll still be
          able to edit the OPSP that gets built from them.
        </p>
        <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <button
            type="button"
            data-testid="submit-not-yet"
            autoFocus
            onClick={onNotYet}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 active:scale-[0.98]"
          >
            Not yet
          </button>
          <button
            type="button"
            data-testid="submit-confirm"
            onClick={onConfirm}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-cobalt-600 px-5 py-2.5 text-sm font-semibold text-white shadow-cobalt hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
          >
            Submit and lock
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewCard({
  position,
  question,
  nameOf,
}: {
  position: number;
  question: ReviewQuestion;
  nameOf: DisplayNameResolver;
}) {
  const text = question.answered
    ? formatAnswerSummary(question.id, question.value, nameOf)
    : "Not answered yet.";

  return (
    <li
      data-testid={`review-${question.id}`}
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card transition-all hover:border-neutral-300 sm:p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 className="text-base font-bold leading-snug text-neutral-900">
          <span className="text-cobalt-600 mr-1.5">{position}.</span>{" "}
          {QUESTION_MAP[question.id].text}
        </h3>
        <a
          data-testid={`edit-${question.id}`}
          href={`/q/${questionRouteSegment(question.id)}?from=review`}
          className="shrink-0 inline-flex items-center rounded-lg bg-neutral-100 hover:bg-cobalt-50 hover:text-cobalt-700 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-neutral-700 transition-colors"
        >
          Edit
        </a>
      </div>

      {question.answered ? (
        <pre
          data-testid={`summary-${question.id}`}
          className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-700 bg-neutral-50/60 p-3.5 rounded-xl border border-neutral-100"
        >
          {text}
        </pre>
      ) : (
        <p className="mt-3 text-sm italic leading-relaxed text-neutral-400">{text}</p>
      )}

      {question.confidence !== null && isConfidenceQuestion(question.id) && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-2.5 py-0.5 text-xs font-semibold text-cobalt-700">
          Confidence: {question.confidence}/5
        </div>
      )}

      {question.privateNote !== null && (
        <div
          data-testid="private-note"
          className="mt-4 rounded-xl border border-cobalt-200 bg-cobalt-50/50 p-4"
        >
          <h4 className="text-xs font-bold uppercase tracking-wider text-cobalt-900">
            Only Paul sees this one.
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed text-neutral-700">
            {question.privateNote}
          </p>
        </div>
      )}
    </li>
  );
}