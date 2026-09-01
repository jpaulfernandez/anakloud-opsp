import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { getPlanPayload } from "@/lib/opsp-plan-db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const modeParam = url.searchParams.get("mode");
  const audienceMode = modeParam === "facilitator" ? "facilitator" : "room";

  let db = null;
  try {
    db = createDbClient();
    await db.connect();
  } catch {
    db = null;
  }

  try {
    const payload = await getPlanPayload(db, audienceMode);
    return NextResponse.json(payload);
  } catch {
    const fallbackPayload = await getPlanPayload(null, audienceMode);
    return NextResponse.json(fallbackPayload);
  } finally {
    if (db) {
      try {
        await db.end();
      } catch {}
    }
  }
}
