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
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <header>
        <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
          You&apos;re all set, {name}.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-neutral-600">
          Your answers are in and the baseline is locked. This is the finished
          version — you can read it back any time.
        </p>
      </header>

      <ol className="mt-8 space-y-4">
        {answered.map((q, idx) => (
          <SubmittedCard key={q.id} position={idx + 1} question={q} nameOf={nameOf} />
        ))}
      </ol>

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <h2 className="text-base font-semibold text-neutral-900">
          Your One-Page Strategic Plan
        </h2>
        <Link
          href="/opsp"
          className="mt-2 inline-block text-base text-neutral-700 underline"
        >
          View your One-Page Strategic Plan
        </Link>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          A printable PDF version will be here to view whenever you come back.
        </p>
      </section>
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
      className="rounded-lg border border-neutral-200 bg-white p-4"
    >
      <h3 className="text-[15px] font-semibold leading-snug text-neutral-900">
        <span className="text-neutral-400">{position}.</span>{" "}
        {QUESTION_MAP[question.id].text}
      </h3>
      <pre
        data-testid={`submitted-summary-${question.id}`}
        className="mt-2 whitespace-pre-wrap font-sans text-base leading-relaxed text-neutral-700"
      >
        {text}
      </pre>

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