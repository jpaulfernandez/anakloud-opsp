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
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <header>
        <p className="text-sm font-medium text-neutral-500">Before you submit</p>
        <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
          Review your answers
        </h1>
        <p className="mt-3 text-base leading-relaxed text-neutral-600">
          Everything below is what your answers add up to. Open any question to
          change it before you lock the baseline in.
        </p>
      </header>

      <ol className="mt-8 space-y-4">
        {answeredList.map((q, idx) => (
          <ReviewCard key={q.id} position={idx + 1} question={q} nameOf={nameOf} />
        ))}
      </ol>

      {skipped.length > 0 && (
        <section aria-label="You skipped these — that's allowed." className="mt-10">
          <h2 className="text-base font-semibold text-neutral-900">
            You skipped these — that&apos;s allowed.
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            You can leave them as they are or open one to answer it later.
          </p>
          <ul className="mt-4 space-y-2">
            {skipped.map((id) => (
              <li key={id} className="flex items-baseline justify-between gap-3">
                <span className="text-neutral-700">{QUESTION_MAP[id].text}</span>
                <a
                  href={`/q/${questionRouteSegment(id)}?from=review`}
                  className="shrink-0 text-sm font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
                >
                  Answer
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex justify-end">
        <button
          type="button"
          data-testid="review-submit"
          onClick={() => setConfirmOpen(true)}
          className={
            complete
              ? "rounded-md bg-neutral-900 px-5 py-2 text-base font-semibold text-white hover:bg-neutral-700"
              : "rounded-md border border-neutral-300 bg-white px-5 py-2 text-base font-medium text-neutral-500"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-6 shadow-lg">
        <h2
          id="submit-confirm-title"
          className="text-lg font-semibold leading-snug text-neutral-900"
        >
          Submitting locks your answers.
        </h2>
        <p className="mt-3 text-base leading-relaxed text-neutral-700">
          You won&apos;t be able to change them afterwards &mdash; that&apos;s
          deliberate, so the baseline stays a baseline. You&apos;ll still be
          able to edit the OPSP that gets built from them.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            data-testid="submit-not-yet"
            autoFocus
            onClick={onNotYet}
            className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-base font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Not yet
          </button>
          <button
            type="button"
            data-testid="submit-confirm"
            onClick={onConfirm}
            className="rounded-md bg-neutral-900 px-4 py-2 text-base font-semibold text-white hover:bg-neutral-700"
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
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-snug text-neutral-900">
          <span className="text-neutral-400">{position}.</span>{" "}
          {QUESTION_MAP[question.id].text}
        </h3>
        <a
          data-testid={`edit-${question.id}`}
          href={`/q/${questionRouteSegment(question.id)}?from=review`}
          className="shrink-0 text-sm font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
        >
          Edit
        </a>
      </div>

      {question.answered ? (
        <pre
          data-testid={`summary-${question.id}`}
          className="mt-2 whitespace-pre-wrap font-sans text-base leading-relaxed text-neutral-700"
        >
          {text}
        </pre>
      ) : (
        <p className="mt-2 text-base leading-relaxed text-neutral-700">{text}</p>
      )}

      {question.confidence !== null && isConfidenceQuestion(question.id) && (
        <p className="mt-2 text-sm text-neutral-500">
          Confidence: {question.confidence}/5
        </p>
      )}

      {question.privateNote !== null && (
        <div
          data-testid="private-note"
          className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 p-3"
        >
          <h4 className="text-sm font-semibold text-neutral-900">
            Only Paul sees this one.
          </h4>
          <p className="mt-1 text-sm leading-relaxed text-neutral-700">
            {question.privateNote}
          </p>
        </div>
      )}
    </li>
  );
}