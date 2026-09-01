import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { getPlanPayload } from "@/lib/opsp-plan-db";
import { OpspEditView } from "../OpspEditView";

export const metadata: Metadata = {
  title: "Edit One-Page Strategic Plan — Anakloud",
  description: "Working edit view for the 33-cell One-Page Strategic Plan with Source Panel",
};

export default async function OpspEditPage() {
  let db = null;
  try {
    db = createDbClient();
    await db.connect();
  } catch {
    db = null;
  }

  try {
    const payload = await getPlanPayload(db, "room");
    return (
      <OpspEditView
        initialCells={payload.cells}
        initialSurveyAnswers={payload.surveyAnswers}
        initialFacilitatorNotes={payload.facilitatorNotes}
        initialAudienceMode="room"
      />
    );
  } finally {
    if (db) {
      try {
        await db.end();
      } catch {}
    }
  }
}
