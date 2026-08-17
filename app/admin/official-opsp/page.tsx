import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";
import { getOrCreateOfficialDraft } from "@/lib/official-opsp";
import { OfficialOPSPView } from "./OfficialOPSPView";

// F15-T01 — the official OPSP canvas route (FR-36, ui_ux.md §4.20). The
// collaborative plan is facilitator-only authoring, so this page sits in the
// admin area behind the same admission decision as the dashboard (F09-T02):
// a non-facilitator is sent back to their own questionnaire, an unsubmitted
// facilitator is held behind the "Finish your own answers first." rule, and a
// submitted facilitator reaches the blank canvas (created as version 1 on
// first open). The draft is read through the facilitator's RLS context, which
// is also what excludes a respondent from ever authoring it.

export const metadata: Metadata = {
  title: "Official One-Page Strategic Plan",
};

export default async function OfficialOPSPPage() {
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    const view = adminPageView(session);
    if (view === "away") redirect("/");
    if (view === "locked") return <OfficialLocked />;

    const draft = await getOrCreateOfficialDraft(
      db,
      session.respondentId,
      session.cohortId,
    );
    return <OfficialOPSPView cells={draft.cells} />;
  } finally {
    await db.end();
  }
}

/**
 * The locked state (FR-28), the same rule the dashboard shows: the official
 * plan is read after the facilitator's own baseline is locked, so an
 * unsubmitted facilitator is held here rather than reaching the canvas.
 */
function OfficialLocked() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Official One-Page Strategic Plan
      </h1>
      <p
        data-testid="official-opsp-locked"
        className="mt-3 text-base leading-relaxed text-neutral-600"
      >
        Finish your own answers first.{" "}
        <Link href="/" className="text-neutral-700 underline">
          Resume your questionnaire
        </Link>
      </p>
    </main>
  );
}