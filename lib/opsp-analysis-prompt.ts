// The individual-OPSP strengths/gaps read (F14-T04, FR-33, spec.md §6.4). The
// single source of truth for the two things that make the FR-33 contract
// enforceable, mirroring how lib/analysis-prompt.ts owns the cohort read:
//
//   1. the system prompt — the read is a report, never an edit. It separates
//      the plan's cells into internally consistent, mutually contradictory, and
//      unfalsifiable, and it must not fill a blank or recommend a change — a
//      facilitator reaching for a rewrite of the founder's own plan is the
//      failure mode this ticket exists to prevent (§6.4 "report, never
//      adjudicate").
//   2. the output schema `{ consistentCells, contradictions,
//      unfalsifiableCells, readNote }` — the model is forced to produce it
//      through tool-use mode, so the three FR-33 categories are impossible to
//      skip and the "positions in the plan's own words" rule is a shape, not a
//      suggestion.
//
// This is facilitator-side AI (§6.4), so the rules are looser than the coach's:
// there is no contamination risk, the answers are locked and the facilitator is
// the only reader. Looser is not unconstrained. The schema carries no field for
// a rewrite, a recommendation or a judgement of blame, and `contradictions`
// states each cell's position verbatim rather than resolving them.
//
// A single plan's read has no cross-respondent labels — the subject is one
// person's own OPSP — so the payload refers to it by an anonymised label and
// carries no name, email or respondent id (those are shaped out upstream in
// lib/opsp-analysis.ts, which also redacts any q14(b) teammate ids that ride in
// a cell value).
//
// No output guard runs here (§5.4 is the coach's guard; the gateway skips it
// for the facilitator-only purposes), so the schema IS the boundary.
//
// Pure module: no I/O, no network, no provider or SDK import, and no identity —
// the context it renders is the anonymised self-contained cell list that
// lib/opsp-analysis.ts builds from the draft's cells.

import type { OpspCellId } from "./opsp";

/** The tool name the model is forced to call (FR-33's structured read). */
export const OPSP_ANALYSIS_RESULT_TOOL_NAME = "opsp_analysis_result";

/**
 * The individual-OPSP analysis system prompt. Verbatim contract for the
 * strengths/gaps read: separate the cells into internally consistent / mutually
 * contradictory / unfalsifiable, state contradictions in the plan's own words,
 * and never rewrite or recommend. The facilitator is the only reader, so
 * nothing here may create the impression of a verdict the founder is wrong.
 */
export const OPSP_ANALYSIS_SYSTEM_PROMPT = `
You are preparing a facilitator to review ONE founder's draft strategic
plan (their One-Page Strategic Plan). For this single plan, identify:

- Internally consistent cells: cells whose content is coherent on its own.
- Contradictions: where two or more cells contradict each other. State
  each cell's position in the plan's own words. Never resolve, soften, or
  rank the contradiction.
- Unfalsifiable cells: cells so vague, circular or untestable that nothing
  could ever check whether the plan met them.

Refer to cells by their exact identifiers (e.g. "brand_promise",
"profit_per_x"). Report what the plan says. Do not rewrite it, do not fill
a blank, and do not recommend what the founder should change. This is
facilitator prep material, not a finding to show the founder.
`.trim();

/** The structured-output tool the model must fill. The schema IS the boundary. */
export const OPSP_ANALYSIS_RESULT_TOOL = {
  name: OPSP_ANALYSIS_RESULT_TOOL_NAME,
  description:
    "A facilitator-ready strengths/gaps read of one founder's OPSP, per FR-33.",
  input_schema: {
    type: "object",
    properties: {
      consistentCells: {
        type: "array",
        items: { type: "string" },
        description:
          "cell ids that are internally consistent and coherent on their own",
      },
      contradictions: {
        type: "array",
        description:
          "pairs of cells that contradict each other; each position in the plan's own words, never resolved or ranked",
        items: {
          type: "object",
          properties: {
            between: { type: "string", description: "the contradiction cell ids, e.g. \"brand_promise and profit_per_x\"" },
            positions: {
              type: "array",
              items: { type: "string" },
              description: "each cell's contradictory position, stated verbatim",
            },
          },
          required: ["between", "positions"],
        },
      },
      unfalsifiableCells: {
        type: "array",
        description:
          "cells so vague, circular or untestable that nothing could check whether the plan met them",
        items: {
          type: "object",
          properties: {
            cell: { type: "string", description: "the unfalsifiable cell id" },
            reason: { type: "string", description: "why it cannot be checked" },
          },
          required: ["cell", "reason"],
        },
      },
      readNote: {
        type: ["string", "null"],
        description:
          "a short plain-language note for the facilitator; never a recommendation to change anything",
      },
    },
    required: ["consistentCells", "contradictions", "unfalsifiableCells", "readNote"],
  },
} as const;

/** One OPSP cell as the model reads it: its id, title and rendered text. */
export interface OpspCellBlock {
  cellId: OpspCellId;
  title: string;
  /** The cell's content as readable text, with any respondent id redacted. */
  text: string;
}

/**
 * The anonymised, self-contained context an individual-OPSP analysis evaluates.
 * One founder's own plan, so there are no A/B/C positions — the subject is a
 * single plan whose cells are listed with their titles. No name, email or
 * respondent id lives anywhere here: those are shaped out in lib/opsp-analysis.ts.
 */
export interface OpspAnalysisRequestContext {
  /** The anonymised label for the plan's owner, per the §5.5 convention. */
  ownerLabel: string;
  /** The draft version being read, so the facilitator can pin a re-run. */
  draftVersion: number;
  /** The plan's non-empty cells, in the mapping's table order. */
  cells: OpspCellBlock[];
}

/** One contradiction between cells, each side in the plan's own words. */
export interface OpspContradiction {
  between: string;
  positions: string[];
}

/** One unfalsifiable cell and the reason nothing could check it. */
export interface OpspUnfalsifiableCell {
  cell: string;
  reason: string;
}

/** One individual-OPSP strengths/gaps read, as FR-33 structures it. */
export interface OpspAnalysisOutput {
  consistentCells: string[];
  contradictions: OpspContradiction[];
  unfalsifiableCells: OpspUnfalsifiableCell[];
  readNote: string | null;
}

/** The Messages body fragments for one individual-OPSP analysis call. */
export interface OpspAnalysisMessages {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: typeof OPSP_ANALYSIS_RESULT_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

/** Render the cells into the user turn: a framing line, then each cell. */
function renderCellBlock(block: OpspCellBlock): string {
  return `${block.title} (${block.cellId}):\n${block.text}`;
}

/**
 * The user turn for one analysis call: a short framing, then each non-empty
 * cell with its title and rendered text, in the mapping's table order.
 */
export function buildOpspAnalysisMessages(
  ctx: OpspAnalysisRequestContext,
  systemPrompt: string = OPSP_ANALYSIS_SYSTEM_PROMPT,
): OpspAnalysisMessages {
  const body = ctx.cells.map(renderCellBlock).join("\n\n");
  const intro = `Below is one founder's draft strategic plan (Draft ${ctx.draftVersion}). Each cell's content is in the founder's own words.\n\n`;
  return {
    system: systemPrompt,
    messages: [{ role: "user", content: `${intro}${body}` }],
    tools: [OPSP_ANALYSIS_RESULT_TOOL],
    tool_choice: { type: "tool", name: OPSP_ANALYSIS_RESULT_TOOL_NAME },
  };
}

/** A model response that did not contain the forced structured output. */
export class MalformedOpspAnalysisOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedOpspAnalysisOutputError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseContradiction(input: unknown): OpspContradiction {
  const o = asRecord(input);
  if (
    o === null ||
    typeof o.between !== "string" ||
    !Array.isArray(o.positions) ||
    !o.positions.every((p) => typeof p === "string") ||
    o.positions.length === 0
  ) {
    throw new MalformedOpspAnalysisOutputError(
      "contradiction must carry between and non-empty string positions",
    );
  }
  return { between: o.between, positions: o.positions as string[] };
}

function parseUnfalsifiable(input: unknown): OpspUnfalsifiableCell {
  const o = asRecord(input);
  if (o === null || typeof o.cell !== "string" || typeof o.reason !== "string") {
    throw new MalformedOpspAnalysisOutputError(
      "unfalsifiable cell must carry cell and reason strings",
    );
  }
  return { cell: o.cell, reason: o.reason };
}

function parseOpspAnalysisResult(input: unknown): OpspAnalysisOutput {
  const o = asRecord(input);
  if (o === null) {
    throw new MalformedOpspAnalysisOutputError("opsp_analysis_result input is not an object");
  }
  if (
    !Array.isArray(o.consistentCells) ||
    !o.consistentCells.every((c) => typeof c === "string")
  ) {
    throw new MalformedOpspAnalysisOutputError("consistentCells must be an array of strings");
  }
  if (!Array.isArray(o.contradictions)) {
    throw new MalformedOpspAnalysisOutputError("contradictions must be an array");
  }
  if (!Array.isArray(o.unfalsifiableCells)) {
    throw new MalformedOpspAnalysisOutputError("unfalsifiableCells must be an array");
  }
  const note = o.readNote;
  if (note !== null && note !== undefined && typeof note !== "string") {
    throw new MalformedOpspAnalysisOutputError("readNote must be a string or null");
  }
  return {
    consistentCells: o.consistentCells as string[],
    contradictions: o.contradictions.map(parseContradiction),
    unfalsifiableCells: o.unfalsifiableCells.map(parseUnfalsifiable),
    readNote: typeof note === "string" ? note : null,
  };
}

/**
 * Turn a model response into an `OpspAnalysisOutput`.
 *
 * Accepts either the raw Anthropic Messages body (a forced
 * `opsp_analysis_result` tool_use block) or a JSON string (the serialized tool
 * input the provider returns). Anything else throws `MalformedOpspAnalysisOutputError`
 * rather than guessing, because there is no §5.4 guard downstream: the parser
 * is the boundary, so a response that does not have the four-field shape is
 * impossible here.
 */
export function parseOpspAnalysisResponse(data: unknown): OpspAnalysisOutput {
  if (typeof data === "string") {
    let json: unknown;
    try {
      json = JSON.parse(data) as unknown;
    } catch {
      throw new MalformedOpspAnalysisOutputError("opsp analysis output is not valid JSON");
    }
    return parseOpspAnalysisResult(json);
  }

  const body = asRecord(data);
  const contentBlocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of contentBlocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== OPSP_ANALYSIS_RESULT_TOOL_NAME) continue;
    return parseOpspAnalysisResult(b.input);
  }
  throw new MalformedOpspAnalysisOutputError(
    `no ${OPSP_ANALYSIS_RESULT_TOOL_NAME} tool call in the model response`,
  );
}