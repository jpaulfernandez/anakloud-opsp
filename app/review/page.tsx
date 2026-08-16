import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { withRespondentContext } from "@/lib/access";
import { listOwnAnswers, type OwnAnswerRow } from "@/lib/answers";
import { listCohortTeammates } from "@/lib/cohort";
import { buildReviewModel, type ReviewAnswerRow } from "@/lib/review";
import { ReviewScreen } from "./ReviewScreen";

// Review route (F06-T01, FR-13, ui_ux.md §4.12).
//
// Same route gate as every respondent-facing screen (requirePageSession →
// ground rules), then loads the respondent's own answers and renders the
// review. It reads through listOwnAnswers — the one read path that includes
// the owner's own q14d private row — inside the respondent's RLS context, so
// the review can truthfully show "the respondent's own Q14(d) content"
// (F06-T01) while no exporter can. The cohort roster is loaded for q14(b)
// teammate names, the same dependency the Q14 question screen needs.
export const metadata: Metadata = {
  title: "Review your answers",
};

export default async function ReviewPage() {
  const db = createDbClient();
  await db.connect();

  let answers: OwnAnswerRow[];
  let cohortId = "";
  let roster: readonly { id: string; displayName: string }[] = [];
  let respondentId = "";
  try {
    const session = await requirePageSession(db);
    respondentId = session.respondentId;
    cohortId = session.cohortId;
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }
    roster = await listCohortTeammates(db, cohortId, respondentId);
    answers = await withRespondentContext(db, respondentId, (tx) =>
      listOwnAnswers(tx),
    );
  } finally {
    await db.end();
  }

  // `updated_at` is a Date and would not survive the RSC boundary; the review
  // only needs the serializable shape.
  const rows: ReviewAnswerRow[] = answers.map((a) => ({
    question_id: a.question_id,
    value: a.value,
    confidence: a.confidence,
    is_private: a.is_private,
  }));
  const questions = buildReviewModel(rows);

  return (
    <ReviewScreen
      questions={questions}
      rosterNames={Object.fromEntries(roster.map((m) => [m.id, m.displayName]))}
    />
  );
}