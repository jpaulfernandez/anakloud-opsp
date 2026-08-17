import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { getOrCreateOfficialDraft } from "@/lib/official-opsp";
import { OfficialOPSPPrintSheet } from "../OfficialOPSPPrintSheet";

// F15-T07 — the official OPSP print route (FR-42, tech_infrastructure §4,
// ui_ux §4.20). This is the sheet a facilitator or the server renders to PDF:
// the same read-only grid the shared F08 print stylesheet targets, with the
// export header (official-plan label, cohort label, timestamp) always present.
//
// The route is gated like every other admin screen — a non-facilitator is sent
// back to their own questionnaire, an unsubmitted facilitator is held behind
// the "Finish your own answers first." rule, and only a submitted facilitator
// reaches the sheet for their own cohort. The sheet data is read through
// getOrCreateOfficialDraft, the official-draft loader that reads the
// `opsp_drafts` cells alone and never the answers table, so no `is_private`
// row can reach the printed official plan.
export const metadata: Metadata = {
  title: "Official One-Page Strategic Plan — print",
};

export default async function OfficialOPSPPrintPage() {
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    const view = adminPageView(session);
    if (view === "away") redirect("/");
    if (view === "locked") redirect("/admin/official-opsp");

    const draft = await getOrCreateOfficialDraft(
      db,
      session.respondentId,
      session.cohortId,
    );

    const { rows } = await db.query<{
      name: string | null;
      quarter_label: string | null;
    }>(
      "select name, quarter_label from cohorts where id = $1",
      [session.cohortId],
    );
    const cohort = rows[0];
    const cohortLabel =
      cohort?.quarter_label && cohort.quarter_label.trim() !== ""
        ? cohort.quarter_label
        : cohort?.name ?? "Official plan";

    return (
      <OfficialOPSPPrintSheet
        cells={draft.cells}
        cohortLabel={cohortLabel}
        printedAt={new Date()}
      />
    );
  } finally {
    await db.end();
  }
}