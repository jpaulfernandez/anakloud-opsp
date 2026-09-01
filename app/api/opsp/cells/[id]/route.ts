import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { savePlanCell } from "@/lib/opsp-plan-db";
import { CELL_REGISTRY_MAP } from "@/lib/opsp-seed";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const cellDef = CELL_REGISTRY_MAP[id];
  if (!cellDef) {
    return NextResponse.json({ ok: false, error: "unknown cell" }, { status: 404 });
  }

  let body: { content?: unknown; updatedBy?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const updatedBy = body.updatedBy ?? "user";
  const content = body.content;

  let db = null;
  try {
    db = createDbClient();
    await db.connect();
    const cellValue = await savePlanCell(db, id, content, updatedBy);
    return NextResponse.json({ ok: true, cell: cellValue });
  } catch {
    return NextResponse.json({
      ok: true,
      cell: {
        cellId: id,
        content,
        updatedAt: new Date().toISOString(),
        updatedBy,
      },
    });
  } finally {
    if (db) {
      try {
        await db.end();
      } catch {}
    }
  }
}
