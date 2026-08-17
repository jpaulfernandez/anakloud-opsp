// F14-T04 — the individual-OPSP strengths/gaps read (FR-33, spec.md §6.4),
// mirroring the F14-T02 cohort-analysis orchestrator shapes but scoped to one
// respondent's own plan.
//
// The ticket's guarantees live in three seams, so each is unit-testable without
// a browser, a database or a model:
//
//   - `buildOpspAnalysisContextFromCells` turns a draft's cells into the
//     anonymised context lib/opsp-analysis-prompt.ts renders. It is the
//     privacy boundary: it renders only a cell's readable value, passes a
//     neutral name resolver to lib/opsp-view's formatter so any q14(b) teammate
//     id renders as "a teammate", and redacts any uuid-shaped token that a
//     free-edited cell might smuggle in — so no respondent id, and therefore
//     no name or email that only an id names, reaches the payload.
//   - the private row exclusion is structural. The payload is built from the
//     OPSP draft's cells, and the deterministic mapping that produced them
//     (F07-T01) never reads the q14d note. Nothing here selects an answers row
//     at all, so an `is_private` row cannot leak.
//   - `serveOpspAnalysis` decides the response by the served level exactly like
//     lib/analyse-endpoint.ts: a full read at L0, queued-plus-structural at L1,
//     and the deterministic structural sibling at L2/L3 — so with the key
//     removed the endpoint returns a usable labelled 200, never an error (PR3).
//
// Every output carries the pinned model id and a generation timestamp
// (FR-35) and is marked with the standing prep label (ui_ux.md §4.19).
//
// The owner read runs inside the facilitator's RLS context, so the draft it
// loads is guaranteed to be in the caller's own cohort by `drafts_facilitator_read`
// (F01-T04); a stranger's or a submitted-owner's draft that is not in the
// cohort simply returns null and the route 404s.

import type { ClientBase } from "pg";
import { withRespondentContext } from "./access";
import { callProvider, type AIProvider, type GatewayContext, type ProviderRequest } from "./ai-gateway";
import { ANALYSIS_PREP_LABEL } from "./analysis-panel";
import {
  enqueueAnalysis,
  type AnalysisQueueWork,
} from "./analysis-queue";
import {
  reportedDeterministicLevel,
  type AnalysisLabel,
} from "./analyse-endpoint";
import { perRequestOutputCap } from "./budget";
import { formatOpspCellValue, OPSP_CELL_LABELS } from "./opsp-view";
import type { ResolvedLevel } from "./config";
import type { OpspCell, OpspCellId, OpspMarking } from "./opsp";
import { OPSP_CELL_IDS } from "./opsp";
import {
  buildOpspAnalysisMessages,
  OPSP_ANALYSIS_RESULT_TOOL,
  parseOpspAnalysisResponse,
  type OpspAnalysisOutput,
  type OpspAnalysisRequestContext,
} from "./opsp-analysis-prompt";

/** The neutral label shown in place of a teammate's id (matches the comparison screen). */
export const OPSP_ANONYMISED_TEAMMATE_LABEL = "a teammate";

/**
 * A respondent id as it might ride in a free-edited cell (F07-T05). The
 * deterministic q14 fragment stores `others` as ids, which the name resolver
 * neutralises; an edited plain-text cell has no resolver to reach, so this scan
 * strips any uuid-shaped token as the belt-and-suspenders half of redaction.
 */
const RESPONDENT_ID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Redact any respondent-id-shaped token that a cell value might carry. */
export function redactRespondentIds(text: string): string {
  return text.replace(RESPONDENT_ID_RE, "[id]");
}

/** The label a whole-cell or per-part mark renders as for the structural summary. */
export function opspMarkLabel(marking: OpspMarking): string {
  if (marking.type === "single") return marking.mark;
  return marking.parts.map((p) => `${p.key}: ${p.mark}`).join("; ");
}

/**
 * Build the anonymised analysis context from a draft's cells (pure). Only
 * non-empty cells are included, in the mapping's table order, each rendered to
 * readable text with q14(b) teammate ids neutralised and any loose uuid-shaped
 * token redacted. `ownerLabel` is the §5.5-style anonymised label; it never
 * carries a name, email or respondent id.
 */
export function buildOpspAnalysisContextFromCells(
  cells: Record<OpspCellId, OpspCell>,
  ownerLabel: string,
  draftVersion: number,
): OpspAnalysisRequestContext {
  const rendered = OPSP_CELL_IDS.filter((id) => {
    const cell = cells[id];
    return cell !== undefined && cell.value !== null && cell.value !== undefined;
  }).map((id): OpspAnalysisRequestContext["cells"][number] => {
    const cell = cells[id];
    const text = redactRespondentIds(
      formatOpspCellValue(cell.value, () => OPSP_ANONYMISED_TEAMMATE_LABEL),
    );
    return { cellId: id, title: OPSP_CELL_LABELS[id], text };
  });
  return { ownerLabel, draftVersion, cells: rendered };
}

/** One cell's structural truth, as the deterministic sibling reports it. */
export interface OpspDeterministicCell {
  cellId: OpspCellId;
  title: string;
  /** Whether the cell carries content (a blank stays blank, F07-T03). */
  filled: boolean;
  /** The ink/pencil/split mark, rendered (F07-T01). */
  mark: string;
  /** True when a confidence-bearing source recorded low confidence (F07-T01). */
  lowConfidence: boolean;
  /** The question ids that fed this cell (provenance, F07-T02). */
  sources: string[];
}

/**
 * The deterministic sibling for the individual-OPSP read (PR3): a structural
 * inventory of which cells are filled, how each is marked, and what fed it.
 * It is deliberately not a content judgement — FR-33's consistent/contradicted/
 * unfalsifiable assessment is the model's job — but it is a usable, labelled
 * read the facilitator still gets when the AI is gone.
 */
export interface OpspDeterministicSummary {
  draftVersion: number;
  filledCount: number;
  cellCount: number;
  cells: OpspDeterministicCell[];
}

/** Build the structural summary from a draft's cells (pure). */
export function buildOpspDeterministicSummary(
  cells: Record<OpspCellId, OpspCell>,
  draftVersion: number,
): OpspDeterministicSummary {
  const summary = OPSP_CELL_IDS.map((id): OpspDeterministicCell => {
    const cell = cells[id];
    const filled = cell !== undefined && cell.value !== null && cell.value !== undefined;
    return {
      cellId: id,
      title: OPSP_CELL_LABELS[id],
      filled,
      mark: cell ? opspMarkLabel(cell.marking) : "pencil",
      lowConfidence: cell ? cell.lowConfidence : false,
      sources: cell ? [...cell.sources] : [],
    };
  });
  return {
    draftVersion,
    filledCount: summary.filter((c) => c.filled).length,
    cellCount: summary.length,
    cells: summary,
  };
}

/** One respondent's latest individual OPSP draft row, read by a facilitator. */
export interface OwnedIndividualDraft {
  id: string;
  version: number;
  cells: Record<OpspCellId, OpspCell>;
}

/**
 * Load a respondent's latest individual OPSP draft, run inside the facilitator's
 * RLS context so `drafts_facilitator_read` (F01-T04) bounds it to the actor's
 * own cohort. Returns null when the owner has no individual draft (never
 * submitted) or is outside the facilitator's cohort.
 */
export async function loadIndividualDraftForOwner(
  db: ClientBase,
  facilitatorRespondentId: string,
  cohortId: string,
  ownerId: string,
): Promise<OwnedIndividualDraft | null> {
  return withRespondentContext(db, facilitatorRespondentId, async (tx) => {
    const { rows } = await tx.query<{ id: string; version: number; cells: unknown }>(
      `select id, version, cells
         from opsp_drafts
        where cohort_id = $1 and owner_type = 'individual' and owner_id = $2
        order by version desc
        limit 1`,
      [cohortId, ownerId],
    );
    const row = rows[0];
    if (!row || row.cells === null || row.cells === undefined) return null;
    return {
      id: row.id,
      version: row.version,
      cells: row.cells as Record<OpspCellId, OpspCell>,
    };
  });
}

/** The response to POST /api/admin/opsp-analysis, by served level. */
export type OpspAnalysisServeBody =
  | {
      ok: true;
      level: "L0";
      ownerLabel: string;
      analysis: OpspAnalysisOutput;
      deterministic: OpspDeterministicSummary;
      label: AnalysisLabel;
      prepLabel: string;
    }
  | {
      ok: true;
      level: "L1";
      ownerLabel: string;
      queued: true;
      deterministic: OpspDeterministicSummary;
      label: AnalysisLabel;
      prepLabel: string;
    }
  | {
      ok: true;
      level: "L2" | "L3";
      ownerLabel: string;
      deterministic: OpspDeterministicSummary;
      label: AnalysisLabel;
      prepLabel: string;
    };

/** Build the provider request for one individual-OPSP call (FR-33 structured read). */
export function buildOpspAnalysisProviderRequest(
  ctx: OpspAnalysisRequestContext,
  model: string,
): ProviderRequest {
  const messages = buildOpspAnalysisMessages(ctx);
  return {
    prompt: "",
    model,
    maxTokens: perRequestOutputCap("analysis"),
    structuredOutput: {
      system: messages.system,
      userMessage: messages.messages[0].content,
      tool: OPSP_ANALYSIS_RESULT_TOOL,
    },
  };
}

/** The outcome of one individual-OPSP attempt through the gateway. */
export interface OpspAnalysisAttempt {
  /** The level that actually served the attempt. */
  served: "L0" | "L1" | "L2";
  /** The parsed FR-33 read, present exactly when the model ran and it parsed. */
  analysis: OpspAnalysisOutput | null;
}

/**
 * Run one individual-OPSP analysis through the gateway and parse the result. A
 * healthy L0 reply that does not parse as FR-33 structured output is treated as
 * a degraded serve (the parser is the boundary; there is no §5.4 guard
 * downstream). The gateway never throws, so this resolves for every error class
 * the provider can throw — the key-removed case included.
 */
export async function runOpspAnalysisAttempt(
  ctx: OpspAnalysisRequestContext,
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
): Promise<OpspAnalysisAttempt> {
  const result = await callProvider(
    gateway,
    provider,
    buildOpspAnalysisProviderRequest(ctx, model),
  );
  if (result.level === "L0" && !result.degraded && result.provider !== undefined) {
    try {
      return { served: "L0", analysis: parseOpspAnalysisResponse(result.provider.text) };
    } catch {
      // Not a FR-33-shaped reply despite a clean gateway pass: fall through to
      // the deterministic sibling rather than surface it as a real read.
    }
  }
  return { served: result.level, analysis: null };
}

/**
 * The single orchestrator the route calls. Builds the anonymised context and
 * the deterministic summary from the loaded draft, runs the read through the
 * gateway, then serves the body its served level demands: the FR-33 read at L0,
 * a queued-plus-structural body at L1 (the background retry is handed the
 * `worker`), and the structural summary at L2/L3. Never throws on AI failure.
 */
export async function serveOpspAnalysis(
  gateway: GatewayContext,
  provider: AIProvider,
  model: string,
  servedLevel: ResolvedLevel,
  jobKey: string,
  worker: AnalysisQueueWork<OpspAnalysisOutput>,
  draft: OwnedIndividualDraft,
  ownerLabel: string,
): Promise<OpspAnalysisServeBody> {
  const ctx = buildOpspAnalysisContextFromCells(draft.cells, ownerLabel, draft.version);
  const deterministic = buildOpspDeterministicSummary(draft.cells, draft.version);

  // FR-35: every output carries the model id and a generation timestamp. The
  // deterministic branch still gets a label — the model clears to "" there so
  // the footer shows only the timestamp, never a fabricated model name.
  const label: AnalysisLabel = {
    model,
    generatedAt: new Date().toISOString(),
  };

  const attempt = await runOpspAnalysisAttempt(ctx, gateway, provider, model);

  if (attempt.served === "L0" && attempt.analysis !== null) {
    return {
      ok: true,
      level: "L0",
      ownerLabel,
      analysis: attempt.analysis,
      deterministic,
      label,
      prepLabel: ANALYSIS_PREP_LABEL,
    };
  }

  if (attempt.served === "L1") {
    // Transient degradation: serve the structural summary now and retry the
    // read in the background so it completes on its own.
    enqueueAnalysis({ key: jobKey, work: worker });
    return {
      ok: true,
      level: "L1",
      ownerLabel,
      queued: true,
      deterministic,
      label,
      prepLabel: ANALYSIS_PREP_LABEL,
    };
  }

  return {
    ok: true,
    level: reportedDeterministicLevel(servedLevel),
    ownerLabel,
    deterministic,
    label,
    prepLabel: ANALYSIS_PREP_LABEL,
  };
}