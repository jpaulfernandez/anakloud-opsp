import { NextResponse } from "next/server";
import { createDbClient } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth";
import { rejectIfCohortReadOnly } from "@/lib/lock";
import { withRespondentContext } from "@/lib/access";
import { anthropicProvider } from "@/lib/ai-gateway";
import { buildAnalysisGatewayContext } from "@/lib/analyse-endpoint";
import {
  buildOfficialCellConflict,
  latestOfficialDraft,
  storeOfficialCellConflict,
} from "@/lib/official-opsp";
import { OPSP_CELL_IDS, type OpspCellId } from "@/lib/opsp";
import {
  buildClassificationContext,
  serveClassification,
  SourceCardCountError,
} from "@/lib/synthesis-classify";

// F15-T03 — the compatibility-classification endpoint (`POST
// /api/admin/synthesise/classify`, tech_infrastructure.md §5.6, FR-39).
//
// This is the first, separate step of the two-step synthesis: when 2+ source
// cards are attached to an official OPSP cell and the facilitator requests a
// synthesis, the system classifies compatibility first, returning
// `{ compatible, reason }`. The classification is its own gateway call — the
// audit row it writes has purpose "synthesis" and question_id null (it is a
// cell, not a question, being judged) — so step 2 (drafting a statement) later
// records a second, distinct call. No synthesis is ever produced here; this
// route only clears or refuses the sources.
//
// The route is admin-gated (F09-T01) and cohort-write-gated like the other
// official-OPSP routes (a closed cohort is read-only). The cell is read from
// the cohort's latest official draft inside the facilitator's RLS context, so
// an outsider's session can never reach a draft outside their cohort. A cell
// with fewer than two source cards earns a 400 — there is nothing to classify.
//
// The payload is built from the source cards (public answer snapshots)
// anonymised A/B/C with only their text and question metadata, so the private
// q14(d) note — which can never be attached as a card (F15-T02) — and every
// respondent identity stay out of the call. Degradation is served (never an
// error): with the key removed the default L2 serves the deterministic refusal,
// so the endpoint returns a labelled 200 rather than a 5xx (PR3). The reason
// string rides in every served body, because showing it to the facilitator is
// an acceptance of this ticket.

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
    // context, so the cell being classified is guaranteed to be in the caller's
    // own cohort. A missing cell/draft is a resource miss, not an AI failure.
    const draft = await withRespondentContext(db, respondentId, (tx) =>
      latestOfficialDraft(tx, cohortId),
    );
    const cell = draft?.cells[cellId];
    if (!cell) return notFound();

    let ctx: ReturnType<typeof buildClassificationContext>;
    try {
      ctx = buildClassificationContext(cell, cellId);
    } catch (err) {
      // Fewer than two source cards — nothing to classify yet (§5.6, ui_ux.md
      // §4.20 "[Synthesise] appears once 2+ sources are attached").
      if (err instanceof SourceCardCountError) return badRequest();
      throw err;
    }

    const { gateway, servedLevel } = await buildAnalysisGatewayContext(
      db,
      { cohortId, respondentId },
      null,
      "synthesis",
    );
    const model = process.env.AI_MODEL ?? "";
    const provider = anthropicProvider(process.env.ANTHROPIC_API_KEY ?? "");

    // Classification is a distinct, separate call from synthesis (F15-T03): it
    // goes through the gateway once and records one ai_interactions row; the
    // later draft step in F15-T04 will be a second call. No background retry
    // queue is wired here (see lib/synthesis-classify.ts).
    const served = await serveClassification(
      ctx,
      gateway,
      provider,
      model,
      servedLevel,
    );

    // F15-T05 — when the verdict is a genuine conflict (the model actually ran
    // at L0 and said incompatible), the refusal enters the conflict result
    // state: both positions are stored on the cell so the facilitator can
    // record a human decision. A degraded serve (no verdict produced) is only a
    // hold — the cell is untouched and there is nothing to choose between.
    if (served.level === "L0" && !served.classification.compatible) {
      const conflict = buildOfficialCellConflict(
        cell.sourceCards,
        served.classification.reason,
      );
      const stored = await storeOfficialCellConflict(
        db,
        respondentId,
        cohortId,
        cellId,
        conflict,
      );
      return NextResponse.json({
        ok: true,
        status: "conflict",
        level: "L0",
        cellId,
        reason: served.classification.reason,
        classification: served.classification,
        version: stored.version,
        cells: stored.cells,
        label: served.label,
      });
    }

    return NextResponse.json(served);
  } finally {
    await db.end();
  }
}