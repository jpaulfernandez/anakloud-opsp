import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { withRespondentContext } from "@/lib/access";
import { latestIndividualDraft, type IndividualDraft } from "@/lib/opsp-draft";
import { listCohortTeammates } from "@/lib/cohort";
import { OPSPView } from "../OPSPView";

// F08-T02 — the authenticated print route (FR-27, tech_infrastructure §7,
// ui_ux §4.16). This is the sheet a respondent or the server renders to PDF:
// the same OPSP grid as the view, served read-only in print mode, with the
// export header (name, timestamp, draft label) always present. Requiring a
// valid session is the same gate as every other respondent screen, and the
// draft is read inside the respondent's RLS context so a respondent can only
// ever render their own plan.
//
// The timestamp is generated server-side at render so the sheet carries when
// it was produced, and the sheet shares the very component the interactive
// view uses — in printMode that component drops the editing chrome — so the
// printed PDF (F08-T03) and the browser's own print from /opsp are equivalent
// by construction rather than by a second layout that could drift.
export const metadata: Metadata = {
  title: "Your One-Page Strategic Plan — print",
};

export default async function OpspPrintPage() {
  const db = createDbClient();
  await db.connect();

  let name = "";
  let rosterNames: Record<string, string> = {};
  let draft: IndividualDraft | null = null;
  let timestamp = new Date();
  try {
    const session = await requirePageSession(db);
    if (session.submittedAt === null || session.submittedAt === undefined) {
      redirect("/");
    }
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }
    const { rows } = await db.query<{ display_name: string | null }>(
      "select display_name from respondents where id = $1",
      [session.respondentId],
    );
    name = rows[0]?.display_name ?? "";
    const roster = await listCohortTeammates(db, session.cohortId, session.respondentId);
    rosterNames = Object.fromEntries(roster.map((m) => [m.id, m.displayName]));
    draft = await withRespondentContext(db, session.respondentId, (tx) =>
      latestIndividualDraft(tx),
    );
    timestamp = new Date();
  } finally {
    await db.end();
  }

  if (!draft) redirect("/");

  return (
    <OPSPView
      cells={draft.cells}
      rosterNames={rosterNames}
      draftId={draft.id}
      name={name}
      printMode
      printedAt={timestamp}
    />
  );
}