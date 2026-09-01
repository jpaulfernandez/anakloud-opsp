import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { getPlanPayload } from "@/lib/opsp-plan-db";
import { OPSPReadView } from "./OPSPReadView";

export const metadata: Metadata = {
  title: "One-Page Strategic Plan — Anakloud",
  description: "Dense read view of the 33-cell One-Page Strategic Plan (Scaling Up)",
};

export default async function OpspPage() {
  let db = null;
  try {
    db = createDbClient();
    await db.connect();
  } catch {
    db = null;
  }

  try {
    const payload = await getPlanPayload(db, "room");
    return <OPSPReadView initialCells={payload.cells} initialAudienceMode="room" />;
  } finally {
    if (db) {
      try {
        await db.end();
      } catch {}
    }
  }
}