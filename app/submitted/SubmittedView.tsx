import Link from "next/link";
import { QUESTION_MAP } from "@/lib/questions";
import { isConfidenceQuestion } from "@/lib/confidence";
import {
  formatAnswerSummary,
  type DisplayNameResolver,
  type ReviewQuestion,
} from "@/lib/review";

// F06-T06 — the submitted read-only view (ui_ux.md §6 "Already submitted",
// FR-14, PR5). A respondent who has submitted lands here instead of on the
// resume/question flow. Their answers are immutable (PR5), so the view is
// framed as the expected outcome of having finished, not as a lockout: the
// copy states the baseline is locked and the answers can be read back any
// time. Nothing here is an input — no Continue, no jump-back links, no edit
// links, no submit button. It is a server component by construction, so the
// absence of editable controls is structural rather than a coordination
// between client pieces: there is no client state for this screen to produce
// a control from.
//
// The OPSP view (F07) is built and linked here as real route; the PDF export
// (F08) is not, so it stays as forward-reference prose rather than a dead link
// to a route that would 404. Once that route lands, the real link wires in
// here. The whole view is served to a submitted respondent regardless of
// cohort status — readOnly admits, never refuses — so a closing cohort never
// takes it away.

export function SubmittedView({
  name,
  questions,
  rosterNames,
}: {
  name: string;
  questions: ReviewQuestion[];
  /** cohort mate id → display name, for q14(b)'s "thinks others own" lines. */
  rosterNames: Record<string, string>;
}) {
  const nameOf: DisplayNameResolver = (rid) => rosterNames[rid];
  // Only answered questions are shown; an unanswered optional one has nothing
  // to render here, and a required one cannot survive submit unanswered.
  const answered = questions.filter((q) => q.answered);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pb-20 text-base">
      <header className="mb-8 rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <div className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-800 border border-emerald-200/60">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
          Baseline Locked
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          You&apos;re all set, {name}.
        </h1>
        <p className="mt-2 text-base leading-relaxed text-neutral-600">
          Your answers are in and the baseline is locked. This is the finished
          version — you can read it back any time.
        </p>

        <div className="mt-6 border-t border-neutral-100 pt-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
            Your One-Page Strategic Plan
          </h2>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href="/opsp"
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
            >
              View your One-Page Strategic Plan
            </Link>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-neutral-500">
            A printable PDF version will be here to view whenever you come back.
          </p>
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between px-1">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-500">
          Submitted Answers
        </h2>
        <span className="text-xs font-semibold text-neutral-400">
          {answered.length} of 15
        </span>
      </div>

      <ol className="space-y-4">
        {answered.map((q, idx) => (
          <SubmittedCard key={q.id} position={idx + 1} question={q} nameOf={nameOf} />
        ))}
      </ol>
    </main>
  );
}

function SubmittedCard({
  position,
  question,
  nameOf,
}: {
  position: number;
  question: ReviewQuestion;
  nameOf: DisplayNameResolver;
}) {
  const text = formatAnswerSummary(question.id, question.value, nameOf);

  return (
    <li
      data-testid={`submitted-${question.id}`}
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6"
    >
      <h3 className="text-base font-bold leading-snug text-neutral-900">
        <span className="text-cobalt-600 mr-1.5">{position}.</span>{" "}
        {QUESTION_MAP[question.id].text}
      </h3>
      <pre
        data-testid={`submitted-summary-${question.id}`}
        className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-neutral-700 bg-neutral-50/60 p-3.5 rounded-xl border border-neutral-100"
      >
        {text}
      </pre>

      {question.confidence !== null && isConfidenceQuestion(question.id) && (
        <div
          data-testid={`submitted-confidence-${question.id}`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-2.5 py-0.5 text-xs font-semibold text-cobalt-700"
        >
          Confidence: {question.confidence}/5
        </div>
      )}

      {question.privateNote !== null && (
        <div
          data-testid={`submitted-private-${question.id}`}
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