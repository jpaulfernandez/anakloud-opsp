// The AI coach prompt and structured output (F13-T01, tech_infrastructure.md
// §5.2, §5.3). The single source of truth for the two things that make the
// §6.2 split enforceable:
//
//   1. the system prompt — verbatim from §5.2. A prompt is a request, not a
//      guarantee, so the §5.4 guard (F13-T03 / lib/coach-containment.ts) is the
//      enforcement and this is the ask;
//   2. the output schema `{ verdict, dimension, hint, example }` — the model is
//      forced to produce it through tool-use mode, so malformed or free-text
//      responses are impossible rather than merely unlikely.
//
// This module is deliberately the only place the coach prompt and the schema
// live. `scripts/coach-containment.ts` imports it, so T1 re-tests the exact
// strings the production coach will send and the guard will check ("changes
// tracked and re-tested against T1"). The F13-T04 endpoint will use the same
// builders and parser.
//
// Pure module, consistent with the F13/F05 pure-function rule: no I/O, no
// network, no provider or SDK import. It neither touches the provider boundary
// nor reads any identity, so the F12-T01 import-scan and the privacy rules both
// hold untouched.

/** The verdict a coach evaluation returns. */
export type CoachVerdict = "ok" | "needs_work";

/** The shape-dimension a needs_work hint points at (§5.3). */
export type CoachDimension =
  | "measurability"
  | "specificity"
  | "single_answer"
  | "too_short"
  | null;

/** Valid `dimension` values, in the §5.3 order, for the schema enum. */
const COACH_DIMENSIONS = [
  "measurability",
  "specificity",
  "single_answer",
  "too_short",
] as const;

/**
 * One coach response, as §5.3 structures it. `example` is empty unless the
 * respondent asked for one; a `verdict: "ok"` always carries an empty `hint`
 * (§5.3 rule: "empty when ok").
 */
export interface CoachOutput {
  verdict: CoachVerdict;
  dimension: CoachDimension;
  hint: string;
  example: string;
}

/** The coach system prompt, verbatim from tech_infrastructure.md §5.2. */
export const COACH_SYSTEM_PROMPT = `
You review a single answer to a single strategy question. You check
whether the answer is USABLE. You never comment on whether it is CORRECT.

You are reviewing form, not content. This is absolute.

YOU MAY:
- Say an answer is not measurable, is ambiguous, contains two answers
  where one was asked for, or is too short to interpret.
- Ask one neutral question that helps the person be more concrete,
  e.g. "What would you point at to show this happened?"
- If and only if example_requested is true, give ONE example from a
  NEUTRAL DOMAIN: a bakery, gym, laundry, courier, or hardware store.
  Frame the example as a shape, not a suggestion, and close it with a
  line in the style "Yours will be about your business, not deliveries."

YOU MUST NOT:
- Suggest a metric, number, customer type, business model, priority,
  risk, product, or value. Not even as a "for instance".
- Mention healthcare, therapy, clinics, doctors, patients, parents,
  children, schools, teachers, or software products. If the neutral
  example you are about to give touches any of these, choose another.
- Say or imply the answer is good, bad, right, or wrong.
- Refer to any other answer or person.
- Exceed 25 words in \`hint\`.

If the answer is usable, return verdict "ok" and an empty hint. Say
nothing when someone has done well.

Bias toward "ok". A blunt, short, strongly-held answer is usable.
Only flag answers that genuinely cannot be interpreted or verified.
`.trim();

/** The tool name the model is forced to call (§5.3). */
export const COACH_RESULT_TOOL_NAME = "coach_result";

/**
 * The structured-output tool the model must fill. In tool-use mode the API
 * refuses plain free text, so the only way out of this call is a valid
 * `coach_result` input (§5.3). The schema is a **request**; the §5.4 guard is
 * what actually trips on any leak.
 *
 * The schema is written in the OpenAPI-3.0-subset dialect Gemini accepts
 * (F18-T02, M07). Two JSON-Schema conveniences would break or silently lose a
 * constraint there, so they are deliberately avoided:
 *   - an array `type: ["string","null"]` is not valid OpenAPI 3.0 — the subset
 *     spells "string or null" as `type: "string"` plus `nullable: true`;
 *   - `null` is not a member of a string `enum` — the subset constrains the
 *     enum to the four real dimensions and expresses the null case through
 *     `nullable`, so a `dimension` is exactly one of the four, or null.
 */
export const COACH_RESULT_TOOL = {
  name: COACH_RESULT_TOOL_NAME,
  description: "The coach's structured verdict on one answer, per spec §5.3.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["ok", "needs_work"] },
      dimension: {
        type: "string",
        enum: ["measurability", "specificity", "single_answer", "too_short"],
        nullable: true,
      },
      hint: { type: "string", description: "≤25 words, empty when ok" },
      example: {
        type: "string",
        description: "neutral domain, only when requested, else empty",
      },
    },
    required: ["verdict", "dimension", "hint", "example"],
  },
} as const;

/** The question metadata and answer text a single coach call evaluates. */
export interface CoachRequestContext {
  /** Stable question id ("q3"…"q11"); used only for tracing, never sent as content. */
  questionId: string;
  /** The question text the respondent is answering. */
  questionText: string;
  /** The helper text shown below the question. */
  helper: string;
  /** Exactly one answer under evaluation — nothing else about the respondent. */
  answer: string;
  /** True only when the respondent explicitly asked for one example (F13-T05). */
  exampleRequested: boolean;
}

/**
 * The Anthropic Messages body fragments for one coach call (§5.2 + §5.3). The
 * fields are named exactly as the wire format expects so `scripts` and the
 * endpoint can hand them to the API or the provider unchanged. Only one answer
 * is present (`Answer:`) and no identity, id or email — the §5.1 payload rule,
 * kept because this is the one place the answer is rendered.
 */
export interface CoachMessages {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: typeof COACH_RESULT_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

/** The user turn: question metadata line, then the answer on its own line. */
export function buildCoachMessages(
  ctx: CoachRequestContext,
  systemPrompt: string = COACH_SYSTEM_PROMPT,
): CoachMessages {
  const askedForExample = ctx.exampleRequested
    ? "\n\nThe respondent asked for ONE shape-of-an-answer example from a neutral domain.\n"
    : "";
  return {
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Question: ${ctx.questionText}\nHelper: ${ctx.helper}\n\nAnswer:\n${ctx.answer}${askedForExample}`,
      },
    ],
    tools: [COACH_RESULT_TOOL],
    tool_choice: { type: "tool", name: COACH_RESULT_TOOL_NAME },
  };
}

/** A model response that did not contain the forced structured output. */
export class MalformedCoachOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedCoachOutputError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Strictly a coach_result input: throws on anything but a five-field output. */
function parseCoachResult(input: unknown): CoachOutput {
  const o = asRecord(input);
  if (o === null) {
    throw new MalformedCoachOutputError("coach_result input is not an object");
  }
  const verdict = o.verdict;
  if (verdict !== "ok" && verdict !== "needs_work") {
    throw new MalformedCoachOutputError(`invalid verdict ${JSON.stringify(verdict)}`);
  }
  const dimension = o.dimension;
  if (
    dimension !== null &&
    dimension !== undefined &&
    (typeof dimension !== "string" ||
      !(COACH_DIMENSIONS as readonly string[]).includes(dimension))
  ) {
    throw new MalformedCoachOutputError(
      `invalid dimension ${JSON.stringify(dimension)}`,
    );
  }
  return {
    verdict,
    dimension:
      typeof dimension === "string" ? (dimension as CoachDimension) : null,
    hint: asString(o.hint),
    example: asString(o.example),
  };
}

/**
 * Turn a model response into a `CoachOutput`.
 *
 * Accepts either the raw Anthropic Messages body (a forced `coach_result`
 * tool_use block) or a JSON string (the serialized tool input the provider
 * returns). Anything else — a plain free-text reply, a missing tool call, an
 * invalid verdict — throws `MalformedCoachOutputError` rather than guessing,
 * so a malformed response is impossible at this boundary too.
 *
 * Note that a response being structured is Necessary but not Sufficient: the
 * §5.4 guard (`lib/coach-containment.ts`) still runs over the result before it
 * reaches a browser. This parser is about shape, the guard is about content.
 */
export function parseCoachResponse(data: unknown): CoachOutput {
  if (typeof data === "string") {
    let json: unknown;
    try {
      json = JSON.parse(data) as unknown;
    } catch {
      throw new MalformedCoachOutputError("coach output is not valid JSON");
    }
    return parseCoachResult(json);
  }

  const body = asRecord(data);
  const blocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of blocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== COACH_RESULT_TOOL_NAME) continue;
    return parseCoachResult(b.input);
  }
  throw new MalformedCoachOutputError(
    `no ${COACH_RESULT_TOOL_NAME} tool call in the model response`,
  );
}