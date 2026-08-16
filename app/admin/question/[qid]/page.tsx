import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { fetchQuestionComparison } from "@/lib/comparison";
import { QUESTION_IDS, QUESTION_MAP, type QuestionId } from "@/lib/questions";
import { divergenceBadgeLabel } from "@/lib/comparison-screen";
import QuestionComparison from "./QuestionComparison";

// F10-T03/F10-T04 — the admin comparison screen (FR-30, ui_ux.md §4.18). The
// workhorse screen: all six answers to one question side by side, with the
// deterministic divergence verdict on top. The admission is the same F09-T01
// gate as the dashboard — only a submitted facilitator gets here — and the
// data comes straight from the same fetchQuestionComparison that backs
// /api/admin/question (F10-T02), so the rendered screen and the API share one
// payload shape.
//
// The page is the anonymised default (F10-T04): it fetches and renders the
// safety posture every load lands in, then hands the rendered and interactive
// board to the client component. The board owns the anonymised ⇄ attributed
// toggle with its confirmation, and re-randomises card order in anonymised
// mode on every load so position cannot infer identity across sessions
// (ui_ux.md §4.18). The verdict badge is deterministic (FR-31) and computed
// here, visible with the AI disabled.
//
// An unsubmitted or non-facilitator never reaches the fetch — an 'away' or
// 'locked' session is redirected to where its state belongs (/ for a
// respondent, /admin for the lock rule), exactly as the dashboard does.

/** Whether a path segment is one of the fifteen stable question ids. */
function isQuestionId(id: string): id is QuestionId {
  return (QUESTION_IDS as readonly string[]).includes(id);
}

export default async function AdminQuestionComparisonPage({
  params,
}: {
  params: Promise<{ qid: string }>;
}) {
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    const view = adminPageView(session);
    if (view === "away") redirect("/");
    if (view === "locked") redirect("/admin");

    const { qid } = await params;
    if (!isQuestionId(qid)) redirect("/admin");

    const comparison = await fetchQuestionComparison(
      db,
      session.respondentId,
      session.cohortId,
      qid,
      "anonymised",
    );

    const definition = QUESTION_MAP[qid];
    const category = comparison.divergence.category;
    const badge =
      category !== null
        ? { category, label: divergenceBadgeLabel(category)! }
        : null;

    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 text-sm">
        <div className="text-neutral-500">
          <Link href="/admin" className="underline">
            Admin
          </Link>
        </div>
        <QuestionComparison
          questionId={qid}
          section={definition.section}
          questionText={definition.text}
          badge={badge}
          initialAnswers={comparison.answers}
        />
      </main>
    );
  } finally {
    await db.end();
  }
}