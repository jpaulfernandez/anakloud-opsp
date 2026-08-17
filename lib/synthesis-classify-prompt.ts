// The compatibility-classification prompt and structured output (F15-T03,
// tech_infrastructure.md §5.6, FR-39, spec.md §5.6). The single source of
// truth for the two things that make the conflict guard enforceable, mirroring
// how lib/analysis-prompt.ts owns the cohort read:
//
//   1. the system prompt — the definition of *compatible* is the whole
//      contract. Compatible means the sources can be stated as one thing
//      without either party losing something they said. That is the line that
//      keeps the classify step from becoming decorative ("compatible" defined
//      loosely would let the guard be gamed).
//   2. the output schema `{ compatible, reason }` — the model is forced to
//      produce it through tool-use mode, so a verdict without a reason is
//      structurally impossible, and an incompatible verdict must carry both
//      positions in the respondents' own words (so a human can choose).
//
// This is the FIRST step of a deliberately two-step synthesis. It only decides
// whether the sources are reconcilable; it never drafts a statement (that is
// F15-T04), so there is deliberately nothing here that could merge, rank or
// smooth two positions.
//
// No output guard runs here (§5.4 is the coach's guard; the gateway skips it
// for the facilitator-only purposes), so the schema IS the boundary — a reply
// that does not carry both fields is not a classification and must not reach
// the facilitator as if it were.
//
// Pure module: no I/O, no network, no provider or SDK import, and no identity —
// the context it renders is the anonymised A/B/C-labelled self-contained card
// list that lib/synthesis-classify.ts builds from an official cell's source
// cards (names and ids are shaped out upstream).

import type { OpspCellId } from "./opsp";

/** The tool name the model is forced to call (§5.6's compatibility verdict). */
export const CLASSIFICATION_RESULT_TOOL_NAME = "compatibility_classification";

/**
 * The classification system prompt. The definition of *compatible* is stated
 * as the one rule that matters, and the one non-negotiable (never merge,
 * soften, rank or hide a position) is restated both here and in the schema it
 * must fill. If incompatible, the reason must put both positions in the
 * respondents' own words so the room can choose — the conflict guard's whole
 * point is that a synthesis must never be produced from an unresolved
 * disagreement.
 */
export const CLASSIFICATION_SYSTEM_PROMPT = `
You are supporting a strategic planning session. The facilitator attached
two or more respondents' answers to one OPSP cell and asked whether they
can be combined into a single statement.

They can be combined ONLY when they can be stated as one thing without
either party losing something they said. That is the entire definition
of compatible.

Return {compatible: boolean, reason: string}.
- compatible=true: the sources can be stated as one statement with
  nothing lost on either side.
- compatible=false: at least one source says something the others
  contradict or leave out. The reason must then state each side's
  position in its own words so a human can choose.

Never merge, soften, rank or hide a position. Never decide which side is
better. This verdict only tells the facilitator whether the sources are
reconcilable at all; it never produces a statement on its own.
`.trim();

/** The structured-output tool the model must fill. The schema IS the boundary. */
export const CLASSIFICATION_RESULT_TOOL = {
  name: CLASSIFICATION_RESULT_TOOL_NAME,
  description:
    "Whether two or more source answers for one OPSP cell can be stated as one thing with nothing lost, per FR-39.",
  input_schema: {
    type: "object",
    properties: {
      compatible: {
        type: "boolean",
        description:
          "true when the sources can be stated as one thing without either party losing something they said",
      },
      reason: {
        type: "string",
        description:
          "why. When incompatible, state each side's position in its own words so a human can choose; never merge, soften, rank or hide a position.",
      },
    },
    required: ["compatible", "reason"],
  },
} as const;

/** One source answer as the model reads it: an anonymised label plus its text. */
export interface ClassificationCardBlock {
  /** The anonymised label, "Respondent A", "Respondent B" — never a name, email or id. */
  label: string;
  /** Question metadata, the answer's source question label, e.g. "Q6". */
  question: string;
  /** The answer text in the respondent's own words (from the attached card). */
  text: string;
}

/**
 * The anonymised, self-contained context a classification call evaluates. One
 * OPSP cell plus the source answers attached to it, each labelled A/B/C. No
 * name, email or respondent id lives anywhere here: those are shaped out
 * upstream in lib/synthesis-classify.ts (the card snapshot's text and question
 * metadata only — privacy rule in AGENTS.md).
 */
export interface ClassificationRequestContext {
  cellId: OpspCellId;
  /** The OPSP cell's human title, e.g. "Sandbox — core customer". */
  cellTitle: string;
  /** The attached source answers, in their attachment order. */
  cards: ClassificationCardBlock[];
}

/** One compatibility verdict, as §5.6 structures it. */
export interface ClassificationOutput {
  compatible: boolean;
  reason: string;
}

/** The Anthropic Messages body fragments for one classification call. */
export interface ClassificationMessages {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: typeof CLASSIFICATION_RESULT_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

/**
 * The user turn for one classification call: a short framing naming the cell,
 * then each source answer as a labelled block in attachment order.
 */
export function buildClassificationMessages(
  ctx: ClassificationRequestContext,
  systemPrompt: string = CLASSIFICATION_SYSTEM_PROMPT,
): ClassificationMessages {
  const body = ctx.cards
    .map((card) => `${card.label} (${card.question}): ${card.text}`)
    .join("\n\n");
  const intro = `Source answers attached to the "${ctx.cellTitle}" cell. Each is a respondent's public answer in their own words.\n\n`;
  return {
    system: systemPrompt,
    messages: [{ role: "user", content: `${intro}${body}` }],
    tools: [CLASSIFICATION_RESULT_TOOL],
    tool_choice: { type: "tool", name: CLASSIFICATION_RESULT_TOOL_NAME },
  };
}

/** A model response that did not contain the forced structured output. */
export class MalformedClassificationOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedClassificationOutputError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseClassificationResult(input: unknown): ClassificationOutput {
  const o = asRecord(input);
  if (o === null) {
    throw new MalformedClassificationOutputError(
      "compatibility_classification input is not an object",
    );
  }
  if (typeof o.compatible !== "boolean") {
    throw new MalformedClassificationOutputError(
      "compatible must be a boolean",
    );
  }
  if (typeof o.reason !== "string" || o.reason.length === 0) {
    throw new MalformedClassificationOutputError(
      "reason must be a non-empty string",
    );
  }
  return { compatible: o.compatible, reason: o.reason };
}

/**
 * Turn a model response into a `ClassificationOutput`.
 *
 * Accepts either the raw Anthropic Messages body (a forced
 * `compatibility_classification` tool_use block) or a JSON string (the
 * serialized tool input the provider returns). Anything else — a plain
 * free-text reply, a missing tool call, a missing field — throws
 * `MalformedClassificationOutputError` rather than guessing, because there is
 * no §5.4 guard downstream: the parser is the boundary, so a response that
 * does not have the two-field shape is impossible here.
 */
export function parseClassificationResponse(data: unknown): ClassificationOutput {
  if (typeof data === "string") {
    let json: unknown;
    try {
      json = JSON.parse(data) as unknown;
    } catch {
      throw new MalformedClassificationOutputError(
        "classification output is not valid JSON",
      );
    }
    return parseClassificationResult(json);
  }

  const body = asRecord(data);
  const contentBlocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of contentBlocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== CLASSIFICATION_RESULT_TOOL_NAME) continue;
    return parseClassificationResult(b.input);
  }
  throw new MalformedClassificationOutputError(
    `no ${CLASSIFICATION_RESULT_TOOL_NAME} tool call in the model response`,
  );
}