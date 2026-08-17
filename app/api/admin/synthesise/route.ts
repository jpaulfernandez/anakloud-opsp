import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { withRespondentContext } from "@/lib/access";
import { anthropicProvider } from "@/lib/ai-gateway";
import { buildAnalysisGatewayContext } from "@/lib/analyse-endpoint";
import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  buildOfficialCellDraft,
  latestOfficialDraft,
  storeOfficialCellDraft,
} from "@/lib/official-opsp";
import {
  buildClassificationContext,
  SourceCardCountError,
} from "@/lib/synthesis-classify";
import { serveSynthesis } from "@/lib/synthesis";

// F15-T04 — the synthesis endpoint with the conflict guard (`POST
// /api/admin/synthesise`, tech_infrastructure.md §5.6, FR-38, FR-39, FR-40,
// spec.md §5.6).
//
// This is STEP 2 of the two-step synthesis and it is guarded server-side:
// `serveSynthesis` re-runs the compatibility classification (its own gateway
// call, its own ai_interactions row) and drafts a statement ONLY when that
// verdict clears as compatible. An incompatible classification — or any
// degraded serve where no model could confirm compatibility — returns a
// refusal with the conflict's reason, and the cell is left untouched. There is
// deliberately no override path, force flag or "merge anyway" parameter here:
// the input is just `{ cellId }`, and a synthesis from incompatible sources is
// structurally unproducible (acceptance: no route, parameter or flag produces
// one).
//
// When it drafts, the statement is written onto the cell as a pending draft
// (FR-40): a new official-draft version whose cell carries `draft` while its
// published `value` stays as it was. It does not enter the official OPSP until
// the facilitator explicitly accepts it (POST /api/admin/synthesise/accept) —
// acceptance is never automatic.
//
// The route is admin-gated (F09-T01) and cohort-write-gated like the classify
// route. A cell with fewer than two source cards earns a 400 — there is nothing
// to classify, hence nothing to draft.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function badRequest() {
  return NextResponse.json({ ok: false }, { status: 400 });
}

function notFound() {
  return NextResponse.json({ ok: false }, { status: 404 });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest();
  }
  if (!isRecord(body)) return badRequest();
  const rawCell = (body as { cellId?: unknown }).cellId;
  if (
    typeof rawCell !== "string" ||
    !(OPSP_CELL_IDS as readonly string[]).includes(rawCell)
  ) {
    return badRequest();
  }
  const cellId = rawCell as OpspCellId;

  const db = createDbClient();
  await db.connect();
  try {
    const auth = await requireAdminSession(db);
    if (!auth.ok) return auth.response;
    const { respondentId, cohortId } = auth.session;

    const readOnly = rejectIfCohortReadOnly(auth.session);
    if (readOnly) return readOnly;

    // Read the cohort's latest official draft under the facilitator's RLS
    // context, so the cell being synthesised is guaranteed to be in the
    // caller's own cohort.
    const draft = await withRespondentContext(db, respondentId, (tx) =>
      latestOfficialDraft(tx, cohortId),
    );
    const cell = draft?.cells[cellId];
    if (!cell) return notFound();

    let ctx: ReturnType<typeof buildClassificationContext>;
    try {
      ctx = buildClassificationContext(cell, cellId);
    } catch (err) {
      // Fewer than two source cards — nothing to classify, hence nothing to
      // draft (§5.6, ui_ux.md §4.20).
      if (err instanceof SourceCardCountError) return badRequest();
      throw err;
    }

    const { gateway } = await buildAnalysisGatewayContext(
      db,
      { cohortId, respondentId },
      null,
      "synthesis",
    );
    const model = process.env.AI_MODEL ?? "";
    const provider = anthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");

    // The guarded synthesis: re-classifies as its own call, drafts only when
    // compatible. `servedLevel` is unused here — the guard outcome, not the
    // level, decides what is returned.
    const served = await serveSynthesis(
      ctx,
      gateway,
      provider,
      model,
    );

    if (served.status === "refused") {
      // The cell is left untouched. The reason (both positions when genuine
      // conflict) rides out so the facilitator can read it.
      return NextResponse.json(served);
    }

    // Drafted: write the statement onto the cell as a pending draft (FR-40),
    // leaving its published value untouched until an explicit accept.
    const pending = buildOfficialCellDraft(cell.sourceCards, served.statement);
    const stored = await storeOfficialCellDraft(
      db,
      respondentId,
      cohortId,
      cellId,
      pending,
    );

    return NextResponse.json({
      ok: true,
      status: "drafted",
      cellId,
      statement: served.statement,
      version: stored.version,
      cells: stored.cells,
      label: served.label,
    });
  } finally {
    await db.end();
  }
}