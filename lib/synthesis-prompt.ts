// The synthesis drafting prompt and structured output (F15-T04, FR-38, FR-39,
// spec.md §5.6, tech_infrastructure.md §5.6). This is STEP 2 of the deliberate
// two-step synthesis and it only runs AFTER the compatibility classification
// (STEP 1, lib/synthesis-classify-prompt.ts) has already cleared the sources
// as reconcilable. Drafting a statement is never the guard's job — the guard is
// enforced upstream before this prompt is reached, and the definition of
// *compatible* lives in the classification prompt, not here.
//
// What this prompt owns: drafting ONE statement that holds the (already
// compatible) sources together as a single thing with nothing lost on either
// side. It must not merge, soften, rank or hide a position; it must not
// invent strategy. The output schema forces a single non-empty `statement`
// string through tool-use mode, so a draft that is empty or unstructured is
// impossible here — a reply that does not fill the tool is not a draft and
// must not reach the canvas as if it were.
//
// No output guard runs for the facilitator-only synthesis purpose (§5.4 is the
// coach's guard; the gateway skips it), so the schema IS the boundary, exactly
// as it is for classification.
//
// Pure module: no I/O, no network, no provider or SDK import, and no identity
// — it renders the anonymised A/B/C-labelled self-contained card list that
// lib/synthesis.ts builds from an official cell's source cards.

import type { ClassificationRequestContext } from "./synthesis-classify-prompt";

/** The tool name the model is forced to call to produce the draft statement. */
export const SYNTHESIS_RESULT_TOOL_NAME = "opsp_statement";

/**
 * The drafting system prompt. It starts from the premise that the sources have
 * already been found compatible — the conflict guard ran — so the only job is
 * to write them as one statement. The one non-negotiable (never merge, soften,
 * rank or hide a position) is restated here and in the schema, mirroring the
 * classification prompt, because a draft that hides what one side said is the
 * same failure the guard exists to prevent, just one step later.
 */
export const SYNTHESIS_SYSTEM_PROMPT = `
You are supporting a strategic planning session. The facilitator has
confirmed that two or more source answers attached to one OPSP cell can
be combined into a single statement. Your job is to draft that one
statement.

The statement must be one thing on which both sources can stand. It must
preserve both sides: nothing either party said may be dropped, hidden,
softened or averaged away. If two answers both have to be true, the
statement holds both together rather than picking one.

Return {statement: string}. The statement must be a single, plain,
human sentence or two. Write in the room's voice, not in corporate
language.

Never merge, soften, rank or hide a position. Never recommend a
strategy, never say which side is better. This is a draft for the
facilitator to read and accept or reject — it is never final on its own.
`.trim();

/** The structured-output tool the model must fill with the draft statement. */
export const SYNTHESIS_RESULT_TOOL = {
  name: SYNTHESIS_RESULT_TOOL_NAME,
  description:
    "One draft statement for one OPSP cell, preserving both compatible source answers with nothing lost, per FR-38.",
  input_schema: {
    type: "object",
    properties: {
      statement: {
        type: "string",
        description:
          "one draft statement that holds the compatible sources together as a single thing, preserving both sides",
      },
    },
    required: ["statement"],
  },
} as const;

/**
 * The context a synthesis draft runs on: one OPSP cell plus the same
 * anonymised source-answer blocks the classification step used. Reuses the
 * classification card shape so both steps see the same self-contained payload.
 */
export type SynthesisRequestContext = ClassificationRequestContext;

/** One drafted statement, as §5.6 step 2 structures it. */
export interface SynthesisOutput {
  statement: string;
}

/** The Anthropic Messages body fragments for one synthesis call. */
export interface SynthesisMessages {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: typeof SYNTHESIS_RESULT_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

/**
 * The user turn for one synthesis call: a short framing naming the cell, then
 * each source answer as a labelled block in attachment order (identical to the
 * classification user turn).
 */
export function buildSynthesisMessages(
  ctx: SynthesisRequestContext,
  systemPrompt: string = SYNTHESIS_SYSTEM_PROMPT,
): SynthesisMessages {
  const body = ctx.cards
    .map((card) => `${card.label} (${card.question}): ${card.text}`)
    .join("\n\n");
  const intro = `Draft one statement for the "${ctx.cellTitle}" cell from these source answers. They have already been found compatible.\n\n`;
  return {
    system: systemPrompt,
    messages: [{ role: "user", content: `${intro}${body}` }],
    tools: [SYNTHESIS_RESULT_TOOL],
    tool_choice: { type: "tool", name: SYNTHESIS_RESULT_TOOL_NAME },
  };
}

/** A model response that did not contain the forced draft tool call. */
export class MalformedSynthesisOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedSynthesisOutputError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseSynthesisResult(input: unknown): SynthesisOutput {
  const o = asRecord(input);
  if (o === null) {
    throw new MalformedSynthesisOutputError("opsp_statement input is not an object");
  }
  if (typeof o.statement !== "string" || o.statement.trim().length === 0) {
    throw new MalformedSynthesisOutputError("statement must be a non-empty string");
  }
  return { statement: o.statement };
}

/**
 * Turn a model response into a `SynthesisOutput`. Accepts either the raw
 * Anthropic Messages body (a forced `opsp_statement` tool_use block) or a JSON
 * string (the serialized tool input). Anything else — free text, a missing
 * tool call, an empty statement — throws `MalformedSynthesisOutputError`, since
 * the schema is the boundary and a malformed reply must not become a draft.
 */
export function parseSynthesisResponse(data: unknown): SynthesisOutput {
  if (typeof data === "string") {
    let json: unknown;
    try {
      json = JSON.parse(data) as unknown;
    } catch {
      throw new MalformedSynthesisOutputError("synthesis output is not valid JSON");
    }
    return parseSynthesisResult(json);
  }

  const body = asRecord(data);
  const contentBlocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of contentBlocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== SYNTHESIS_RESULT_TOOL_NAME) continue;
    return parseSynthesisResult(b.input);
  }
  throw new MalformedSynthesisOutputError(
    `no ${SYNTHESIS_RESULT_TOOL_NAME} tool call in the model response`,
  );
}