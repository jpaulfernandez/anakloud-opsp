import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { withRespondentContext } from "@/lib/access";
import { latestIndividualDraft, type IndividualDraft } from "@/lib/opsp-draft";
import { listCohortTeammates } from "@/lib/cohort";
import { OPSPView } from "./OPSPView";

// The individual OPSP route (F07-T02, FR-22/23, ui_ux.md §4.14) — the draft
// sheet a submitted respondent reaches from their finished view.
//
// Same gate as every respondent screen (requirePageSession → ground rules),
// then two F07-specific guards:
//   * Only a submitted respondent has a plan. The draft is created at submit
//     (F06-T03), so an unsubmitted respondent is sent back to the resume flow
//     at "/" — there is nothing to show them yet. This guard also keeps the
//     route off the unsubmitted respondent's path, mirroring how the review and
//     question routes guard the other direction.
//   * The draft is read inside the respondent's RLS context (drafts_own_read
//     allows owner_type='individual' and owner_id = current respondent), so a
//     respondent can only ever see their own plan, never a cohort mate's.
//
// When no draft row exists the respondent is redirected to "/" rather than
// shown an error: a submitted respondent always has version 1, so this only
// arises from a test fixture that stamped submission without the submit path —
// and the honest response to "there is no plan" is the finished view, not a
// broken sheet.
export const metadata: Metadata = {
  title: "Your One-Page Strategic Plan",
};

export default async function OpspPage() {
  const db = createDbClient();
  await db.connect();

  let rosterNames: Record<string, string> = {};
  let draft: IndividualDraft | null = null;
  try {
    const session = await requirePageSession(db);
    if (session.submittedAt === null || session.submittedAt === undefined) {
      redirect("/");
    }
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }
    const roster = await listCohortTeammates(db, session.cohortId, session.respondentId);
    rosterNames = Object.fromEntries(roster.map((m) => [m.id, m.displayName]));
    draft = await withRespondentContext(db, session.respondentId, (tx) =>
      latestIndividualDraft(tx),
    );
  } finally {
    await db.end();
  }

  if (!draft) redirect("/");

  return <OPSPView cells={draft.cells} rosterNames={rosterNames} draftId={draft.id} />;
}