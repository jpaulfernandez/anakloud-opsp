import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { resolveSession, SESSION_COOKIE } from "@/lib/session";
import { withRespondentContext } from "@/lib/access";
import { listOwnAnswers } from "@/lib/answers";
import { listCohortTeammates } from "@/lib/cohort";
import { buildReviewModel, type ReviewAnswerRow } from "@/lib/review";
import {
  firstUnanswered,
  isRegisteredQuestion,
  questionNeighbors,
  questionRouteSegment,
} from "@/lib/navigation";
import { QUESTION_IDS, QUESTION_MAP, type QuestionId } from "@/lib/questions";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { StartOrResumeForm } from "./StartOrResumeForm";
import { SubmittedView } from "./submitted/SubmittedView";

// The resume landing (F04-T05, FR-8, ui_ux.md §3.2). This is what every
// returning respondent reaches after a claim — the session destination once a
// display name and the ground-rules acknowledgement are in place. The two
// hard rules from the feature README are encoded here:
//
//  - Resume never lands at Q1. Continue goes to the first unanswered question
//    (firstUnanswered walks the registry order, so a Q7/Q8 gap with Q9 already
//    answered still lands on Q7, not Q10), and the screen also lists every
//    answered question so a returning respondent can jump back to any of them.
//  - A submitted respondent never re-enters the flow. submitted_at non-null
//    routes them to a read-only, form-free state instead of the Continue
//    screen; F06-T06 will own the fuller read-only answer view, and until then
//    this stays the guard that keeps a locked respondent out of the questions.
//
// The page also serves the root "/" as the anonymous landing: this route is
// CLAIM_SCREEN (lib/auth), so an unauthenticated visitor must see a page here
// rather than a redirect-to-self. With no session cookie the page renders the
// start new or resume return entry and never touches the database.

export const metadata: Metadata = {
  title: "Welcome back",
};

/** The review screen F06-T01 owns; the resume landing links out to it. */
const REVIEW_DESTINATION = "/review";

export default async function HomePage() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  // Anonymous: no cookie, or a cookie that does not resolve. Never a database
  // touch on this path, so "/" stays renderable without DATABASE_URL.
  if (!token) return <AnonymousLanding />;

  const db = createDbClient();
  await db.connect();
  try {
    const session = await resolveSession(db, token);
    if (!session) return <AnonymousLanding />;

    // The ground-rules gate (FR-5 / F02-T05) sits in front of every question
    // and here too, so a respondent who has not acknowledged never sees the
    // resume screen or its answers. On the normal resume path the
    // acknowledgement is already set, so this redirect is a guard, not the
    // common case.
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }

    const { rows } = await db.query<{ display_name: string | null }>(
      "select display_name from respondents where id = $1",
      [session.respondentId],
    );
    const name = rows[0]?.display_name ?? "there";

    // A submitted respondent is locked (PR5): route off the flow and into the
    // read-only view of their answers (F06-T06). No Continue, no jump-back
    // list — the answers are immutable now, so the only truthful frame is
    // finished, not editable (ui_ux.md §6 "Already submitted"). The view is
    // served regardless of cohort status (readOnly admits, never refuses), so
    // a closing cohort never takes it away.
    if (session.submittedAt !== null && session.submittedAt !== undefined) {
      const { questions, rosterNames } = await readOnlyViewModel(
        db,
        session.respondentId,
        session.cohortId,
      );
      return <SubmittedView name={name} questions={questions} rosterNames={rosterNames} />;
    }

    // All of the caller's own answers (listOwnAnswers is the one read path that
    // returns private rows, running inside the respondent's RLS context). Only
    // registered question ids count toward "answered" — the private q14d row is
    // not a question, so it must not mask an unanswered q14.
    const answers = await withRespondentContext(db, session.respondentId, (tx) =>
      listOwnAnswers(tx),
    );
    const answered = new Set<QuestionId>();
    for (const a of answers) {
      if (isRegisteredQuestion(a.question_id)) answered.add(a.question_id);
    }
    const ordered = (QUESTION_IDS as readonly QuestionId[]).filter((id) =>
      answered.has(id),
    );

    return <ResumeLanding name={name} answered={ordered} />;
  } finally {
    await db.end();
  }
}

/** The unauthenticated "/": invite links land here to claim; a resume code
 * gets entered here to restore a session. Stays renderable with no database. */
function AnonymousLanding() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 inline-flex items-center justify-center rounded-xl bg-cobalt-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
            Anakloud
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            Align
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">
            Figure out where the six of you actually agree.
          </p>
        </div>

        <section className="border-t border-neutral-100 pt-6">
          <StartOrResumeForm />
        </section>
      </div>
    </main>
  );
}

/**
 * The resume landing for a partially complete, unsubmitted session: a greeting
 * naming the respondent, their position (the first unanswered question), and a
 * way back in — Continue to the first unanswered, Review, and a jump-back list
 * of every answered question.
 */
function ResumeLanding({
  name,
  answered,
}: {
  name: string;
  answered: readonly QuestionId[];
}) {
  const next = firstUnanswered(new Set(answered));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12 text-base">
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-1 text-xs font-medium text-cobalt-700">
          <span className="h-1.5 w-1.5 rounded-full bg-cobalt-600" />
          Questionnaire in progress
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          Welcome back, {name}.
        </h1>
        {next === null ? (
          <p className="mt-2 text-base leading-relaxed text-neutral-600">
            You&apos;ve answered every question.
          </p>
        ) : (
          <p className="mt-2 text-base leading-relaxed text-neutral-600">
            You&apos;re on question {positionOf(next)} of 15.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          {next !== null ? (
            <Link
              href={`/q/${questionRouteSegment(next)}`}
              className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800"
            >
              Continue
            </Link>
          ) : null}
          <Link
            href={REVIEW_DESTINATION}
            className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-5 py-3 text-base font-medium text-neutral-800 shadow-subtle transition-all hover:border-neutral-400 hover:bg-neutral-50 active:scale-[0.98]"
          >
            Review what I&apos;ve answered
          </Link>
        </div>
      </div>

      {answered.length > 0 ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">
              Answered so far
            </h2>
            <span className="text-xs text-neutral-400">
              {answered.length} of 15
            </span>
          </div>
          <ul className="divide-y divide-neutral-100 overflow-hidden rounded-2xl border border-neutral-200/80 bg-white shadow-card">
            {answered.map((id) => (
              <li key={id}>
                <Link
                  href={`/q/${questionRouteSegment(id)}`}
                  className="flex min-h-[52px] items-center justify-between gap-4 px-4 py-3.5 text-sm text-neutral-800 transition-colors hover:bg-cobalt-50/50 hover:text-cobalt-900"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobalt-50 text-xs font-semibold text-cobalt-700">
                      {positionOf(id)}
                    </span>
                    <span className="font-medium">{QUESTION_MAP[id].text}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-cobalt-600">
                    Edit &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/**
 * Load what the submitted read-only view (F06-T06) needs: the respondent's own
 * answers shaped through the same review model the review screen uses, plus
 * the cohort roster for q14(b)'s "thinks others own" names. Reads through the
 * respondent's RLS context via listOwnAnswers (the one read that includes the
 * owner's own q14d private row), so the finished view shows the owner their
 * own note just as the review screen did.
 */
async function readOnlyViewModel(
  db: ReturnType<typeof createDbClient>,
  respondentId: string,
  cohortId: string,
): Promise<{
  questions: ReturnType<typeof buildReviewModel>;
  rosterNames: Record<string, string>;
}> {
  const roster = await listCohortTeammates(db, cohortId, respondentId);
  const answers = await withRespondentContext(db, respondentId, (tx) =>
    listOwnAnswers(tx),
  );
  const rows: ReviewAnswerRow[] = answers.map((a) => ({
    question_id: a.question_id,
    value: a.value,
    confidence: a.confidence,
    is_private: a.is_private,
  }));
  return {
    questions: buildReviewModel(rows),
    rosterNames: Object.fromEntries(roster.map((m) => [m.id, m.displayName])),
  };
}

/** The one-based "n of 15" position of a registered question. */
function positionOf(id: QuestionId): number {
  return questionNeighbors(id)!.absolute;
}