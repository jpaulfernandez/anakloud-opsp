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
import { ResumeCodeForm } from "./ResumeCodeForm";
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
// resume-code return entry and never touches the database.

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
    <main>
      <h1>Align</h1>
      <p>Anakloud strategic alignment questionnaire.</p>
      <section>
        <p>Been here before?</p>
        <p>Enter your resume code to pick up where you left off.</p>
        <ResumeCodeForm />
      </section>
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
    <main>
      <h1>Welcome back, {name}.</h1>
      {next === null ? (
        <p>You&apos;ve answered every question.</p>
      ) : (
        <p>You&apos;re on question {positionOf(next)} of 15.</p>
      )}
      <div>
        {next !== null ? (
          <Link href={`/q/${questionRouteSegment(next)}`}>Continue</Link>
        ) : null}
        <Link href={REVIEW_DESTINATION}>Review what I&apos;ve answered</Link>
      </div>
      {answered.length > 0 ? (
        <>
          <h2>Answered so far</h2>
          <ul>
            {answered.map((id) => (
              <li key={id}>
                <Link href={`/q/${questionRouteSegment(id)}`}>
                  {QUESTION_MAP[id].text}
                </Link>
              </li>
            ))}
          </ul>
        </>
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