import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { questionNeighbors, toQuestionId } from "@/lib/navigation";
import { QUESTION_MAP } from "@/lib/questions";
import { QuestionShell } from "./QuestionShell";

// Question route (F03-T01, FR-6, FR-8, FR-9, ui_ux.md §4.3, D1).
//
// The route gate is unchanged from F02-T05: requirePageSession bounces an
// unauthenticated visitor to the claim screen and an unacknowledged respondent
// to /ground-rules. What changed is the body — this page now renders the real
// question shell, one question per screen (FR-6). A URL outside q1..q15 404s
// before any database work: the registry is the whole definition of a valid
// question id, and an unknown route must never render a half-shell. The shell
// itself is a client component because forward/back navigation and the
// Continue block are interactions, not render-time decisions.
export const metadata: Metadata = {
  title: "Questionnaire",
};

export default async function QuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // The URL segment is the plain number ("/q/3" → "3"); the registry key is
  // "q3". Map one to the other so an out-of-range URL 404s before any DB work.
  const qid = toQuestionId(id);
  if (qid === null) notFound();

  const db = createDbClient();
  await db.connect();
  let respondentId = "";
  try {
    const session = await requirePageSession(db);
    respondentId = session.respondentId;
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }
  } finally {
    await db.end();
  }

  return (
    <QuestionShell
      question={QUESTION_MAP[qid]}
      neighbors={questionNeighbors(qid)!}
      // Q8's pool shuffle is seeded per respondent (F03-T07): two respondents
      // in the same cohort see different pool orders, and a single respondent
      // keeps a stable one across reloads.
      poolSeed={respondentId}
    />
  );
}