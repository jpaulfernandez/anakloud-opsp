import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { fetchQuestionComparison } from "@/lib/comparison";
import { QUESTION_IDS, QUESTION_MAP, type QuestionId } from "@/lib/questions";
import {
  comparisonAnswerText,
  divergenceBadgeLabel,
} from "@/lib/comparison-screen";
import type { DivergenceCategory } from "@/lib/divergence";

// F10-T03 — the admin comparison screen (FR-30, ui_ux.md §4.18). The workhorse
// screen: all six answers to one question side by side, with the deterministic
// divergence verdict on top. The admission is the same F09-T01 gate as the
// dashboard — only a submitted facilitator gets here — and the data comes
// straight from the same fetchQuestionComparison that backs /api/admin/question
// (F10-T02), so the rendered screen and the API share one payload shape.
//
// This ticket renders the screen in its anonymised default (F10-T04 adds the
// mode toggle and confirmation): answers as equal-height cards in a responsive
// grid, full text visible without truncation or a modal, each answer's
// confidence where the question carries one, and the divergence badge computed
// deterministically (FR-31) so it is visible with the AI disabled. Density is
// tighter than the questionnaire (ui_ux.md §2): small type, snug padding.
//
// An unsubmitted or non-facilitator never reaches the fetch — an 'away' or
// 'locked' session is redirected to where its state belongs (/ for a
// respondent, /admin for the lock rule), exactly as the dashboard does.

/**
 * Whether a path segment is one of the fifteen stable question ids. Kept
 * local alongside the route's copy so the route and the page each fail an
 * unknown id before any answer query runs.
 */
function isQuestionId(id: string): id is QuestionId {
  return (QUESTION_IDS as readonly string[]).includes(id);
}

const BADGE_STYLE: Record<
  DivergenceCategory | "manual review",
  string
> = {
  aligned: "bg-emerald-50 text-emerald-800",
  "soft split": "bg-amber-50 text-amber-800",
  "hard split": "bg-red-50 text-red-800",
  "manual review": "bg-neutral-100 text-neutral-700",
};

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

    // Anonymised is the product's default comparison posture; the toggle and
    // its confirmation are F10-T04.
    const comparison = await fetchQuestionComparison(
      db,
      session.respondentId,
      session.cohortId,
      qid,
      "anonymised",
    );

    const definition = QUESTION_MAP[qid];
    const category = comparison.divergence.category;
    const badge = divergenceBadgeLabel(category);

    return (
      <main className="mx-auto w-full max-w-5xl px-4 pb-10 pt-4 text-sm">
        <div className="text-neutral-500">
          <Link href="/admin" className="underline">
            Admin
          </Link>
        </div>
        <header className="mt-1 border-b border-neutral-200 pb-3">
          <div className="text-xs uppercase tracking-wide text-neutral-500">
            Q{qid.replace("q", "")} · {definition.section}
          </div>
          <div className="mt-1 flex items-start justify-between gap-3">
            <h1 className="text-[19px] leading-snug font-semibold text-neutral-900 md:text-[24px]">
              {definition.text}
            </h1>
            {category !== null ? (
              <span
                data-testid="divergence-badge"
                className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_STYLE[category]}`}
              >
                {badge}
              </span>
            ) : null}
          </div>
        </header>

        {comparison.answers.length === 0 ? (
          <p className="mt-6 text-neutral-500">
            No one has answered this question yet.
          </p>
        ) : (
          <ul
            data-testid="comparison-grid"
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {comparison.answers.map((answer, i) => (
              <li
                key={i}
                data-testid="answer-card"
                className="flex h-full flex-col rounded-md border border-neutral-200 bg-white p-3"
              >
                <p
                  data-testid="answer-text"
                  className="flex-1 whitespace-pre-line text-[13px] leading-relaxed text-neutral-800"
                >
                  {comparisonAnswerText(qid, answer.value, true)}
                </p>
                {answer.confidence !== null ? (
                  <div
                    data-testid="answer-confidence"
                    className="mt-2 border-t border-neutral-100 pt-1.5 text-xs text-neutral-500"
                  >
                    Confidence {answer.confidence}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </main>
    );
  } finally {
    await db.end();
  }
}