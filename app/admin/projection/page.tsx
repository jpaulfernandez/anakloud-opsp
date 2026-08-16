import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import {
  fetchQuestionComparison,
  type ComparisonAnswerAnonymised,
} from "@/lib/comparison";
import { projectQuestion, type ProjectionQuestion } from "@/lib/projection";
import { QUESTION_IDS } from "@/lib/questions";
import ProjectionSheet from "./ProjectionSheet";

// F10-T06 — the projection sheet export (FR-34, ui_ux.md §4.18). The comparison
// of all fifteen questions re-laid out for a wall: larger type, untruncated
// anonymised cards, the deterministic divergence verdict on each question. It
// is unconditionally anonymised — the page fetches every question through
// fetchQuestionComparison with mode="anonymised" (never attributed), the
// ComparisonAnswerAnonymised answers carry no name/email/id by construction,
// and lib/projection.ts redacts Q14(b) teammate ids exactly like the comparison
// screen and consumes no identity field at all, so there is no option that
// could produce an attributed sheet. Private rows never enter: the answer rows
// come from listPublicAnswersForQuestion, which filters `is_private` in the
// SQL (F01-T03). Hence the sheet cannot contain names, emails, respondent
// identifiers or private notes under any option — enforced here, in the data
// and typing layer, not by a client hiding them.
//
// Admission is the same F09-T01 gate as the dashboard and comparison screen:
// only a submitted facilitator reaches the fetches; an 'away' or 'locked'
// session is redirected to where its state belongs. Each question is fetched
// and projected once, in stable registry order, and the whole sheet is
// server-rendered so the legibility and privacy guarantees hold before any
// browser runs.
export default async function AdminProjectionPage() {
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    const view = adminPageView(session);
    if (view === "away") redirect("/");
    if (view === "locked") redirect("/admin");

    // One anonymised comparison per question. The mode is a constant, never a
    // query/URL value, so nothing a facilitator can type or reload turns the
    // projection sheet attributed.
    const questions: ProjectionQuestion[] = [];
    for (const qid of QUESTION_IDS) {
      const comparison = await fetchQuestionComparison(
        db,
        session.respondentId,
        session.cohortId,
        qid,
        "anonymised",
      );
      questions.push(
        projectQuestion(qid, {
          // The fetch above is called with the literal mode "anonymised", so
          // its answers are genuinely ComparisonAnswerAnonymised — the cast
          // narrows the shared union to the identity-free branch, never the
          // attributed one.
          answers: comparison.answers as ComparisonAnswerAnonymised[],
          divergence: comparison.divergence,
        }),
      );
    }

    return (
      <>
        <div className="border-b border-neutral-200 bg-neutral-50">
          <div className="mx-auto w-full max-w-6xl px-4 py-3 text-sm text-neutral-600">
            <Link href="/admin" className="underline" data-testid="projection-back">
              Back to Admin
            </Link>
            <span className="ml-3 hidden print:hidden md:inline">
              Project this sheet, or use your browser&apos;s Print to keep a copy.
            </span>
          </div>
        </div>
        <ProjectionSheet questions={questions} />
      </>
    );
  } finally {
    await db.end();
  }
}