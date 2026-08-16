// The facilitator-analysis prompt and structured output (F14-T01,
// tech_infrastructure.md §5.5, spec.md §6.4, FR-32). The single source of
// truth for the two things that make the §5.5 contract enforceable:
//
//   1. the system prompt — verbatim from §5.5. A prompt is a request, not a
//      guarantee, so the one hard constraint (report, never adjudicate) is
//      restated both here and in the output schema it must fill;
//   2. the output schema `{ agreement, conflicts, askInRoom, wordingNote }` —
//      the model is forced to produce it through tool-use mode, so the
//      "where they agree / where they don't / what to ask in the room"
//      structure the ticket requires is impossible to skip, not merely
//      unlikely to be skipped.
//
// This is facilitator-side AI (spec.md §6.4), which is why the rules are
// looser than the coach: there is no contamination risk, the answers are
// already locked and the facilitator is the only reader. Looser is not
// unconstrained. One rule is absolute and is enforced in the schema itself:
// `conflicts` carries each position in the respondents' own words and there is
// no field for a winner, a rank or a recommendation — the model physically
// cannot say which view is better through this shape. The single permitted
// judgement (a disagreement that looks like wording rather than substance) has
// its own dedicated `wordingNote` field so it can never be smuggled into a
// `conflicts` entry as an adjudication.
//
// No output guard runs here (§5.4 is the coach's guard; lib/ai-gateway.ts
// skips it for the facilitator-only purposes), so the schema IS the boundary.
//
// Pure module: no I/O, no network, no provider or SDK import. It never touches
// the provider boundary and reads no identity — the payload it renders is the
// anonymised A/B/C-shaped context that lib/analysis-request.ts builds.

import type { QuestionId } from "./questions";

/** The tool name the model is forced to call (§5.5 structure). */
export const ANALYSIS_RESULT_TOOL_NAME = "analysis_result";

/**
 * The facilitator-analysis system prompt, verbatim from
 * tech_infrastructure.md §5.5. The §5.5 contract in full: report what the
 * answers say, structure the read into agreement/conflict/questions, never
 * recommend a strategy or pick a side, and reserve exactly one judgement — a
 * difference in wording rather than substance — to an explicit statement.
 */
export const ANALYSIS_SYSTEM_PROMPT = `
You are preparing a facilitator for a founders' alignment session.
Report what the answers say. Do not decide who is right.

Structure:
- Where they agree: the shared position, stated plainly.
- Where they don't: each position in the respondents' own words.
  Never merge, soften, or rank the positions.
- What to ask in the room: 2-3 specific questions that would force
  the disagreement into the open.

Never recommend a strategy. Never say which view is better. If a
disagreement looks like a difference in wording rather than
substance, say so explicitly — that is the one judgement you may make.
`.trim();

/**
 * The structured-output tool the model must fill. In tool-use mode the API
 * refuses plain free text, so the only way out of this call is a valid
 * `analysis_result` input (§5.5). The schema **is** the enforcement here —
 * unlike the coach there is no separate §5.4 guard, so the four fields and
 * their shapes define at the API level what an analysis output may be.
 */
export const ANALYSIS_RESULT_TOOL = {
  name: ANALYSIS_RESULT_TOOL_NAME,
  description: "A facilitator-ready read of the cohort's answers, per spec §5.5.",
  input_schema: {
    type: "object",
    properties: {
      agreement: {
        type: "string",
        description: "where they agree: the shared position, stated plainly",
      },
      conflicts: {
        type: "array",
        description:
          "where they don't agree: each position in the respondents' own words. " +
          "Never merge, soften, or rank the positions; there is no field for a winner.",
        items: {
          type: "object",
          properties: {
            between: { type: "string", description: "the anonymised labels, e.g. \"A and B\"" },
            positions: {
              type: "array",
              items: { type: "string" },
              description: "each conflicting position, stated verbatim, never ranked",
            },
          },
          required: ["between", "positions"],
        },
      },
      askInRoom: {
        type: "array",
        items: { type: "string" },
        description: "2-3 specific questions that would force the disagreement into the open",
      },
      wordingNote: {
        type: ["string", "null"],
        description:
          "the one permitted judgement: explicitly states when a disagreement looks a difference " +
          "in wording rather than substance; else null. Never used to rank positions.",
      },
    },
    required: ["agreement", "conflicts", "askInRoom", "wordingNote"],
  },
} as const;

/** The anonymised respondent label as the payload refers to a respondent. */
export interface AnalysisRespondentPosition {
  /** The anonymised label, "A", "B", "C"… — never a name, email or id. */
  respondent: string;
  /** The position in the respondent's own — redacted — words. */
  text: string;
}

/** One question's set of positions, as the model reads them. */
export interface AnalysisQuestionBlock {
  questionId: QuestionId;
  /** The question text being answered. */
  questionText: string;
  /** Each respondent's position on this question. Not present for the private note. */
  positions: AnalysisRespondentPosition[];
}

/** Whether the analysis covers one question or the whole cohort. */
export type AnalysisScope = "question" | "cohort";

/**
 * The anonymised, self-contained context an analysis call evaluates. It is the
 * whole prompt's subject: question metadata plus positions labelled A/B/C, with
 * no name, email or respondent id anywhere (those are shaped out upstream in
 * lib/analysis-request.ts). A `cohort` scope carries one block per answered
 * question; a `question` scope carries exactly one.
 */
export interface AnalysisRequestContext {
  scope: AnalysisScope;
  /** Stable question id for the single-question scope; null for the whole cohort. */
  questionId: QuestionId | null;
  blocks: AnalysisQuestionBlock[];
}

/**
 * One analysis output, as §5.5 structures it. The four fields map onto the
 * three-section structure (agreement / where they don't / ask in the room)
 * plus the single permitted judgement. There is deliberately no field for a
 * verdict, a rank or a recommendation: an output that adjudicates is
 * structurally impossible, which is what "report, never decide" looks like as
 * a type rather than a promise.
 */
export interface AnalysisOutput {
  agreement: string;
  conflicts: Array<{ between: string; positions: string[] }>;
  askInRoom: string[];
  wordingNote: string | null;
}

/**
 * The Anthropic Messages body fragments for one analysis call (§5.5). Fields
 * are named exactly as the wire format expects so callers can hand them to the
 * provider unchanged. The user turn carries only the anonymised positions plus
 * question metadata — no identity is rendered because the context type cannot
 * hold one.
 */
export interface AnalysisMessages {
  system: string;
  messages: Array<{ role: "user"; content: string }>;
  tools: typeof ANALYSIS_RESULT_TOOL[];
  tool_choice: { type: "tool"; name: string };
}

/** One question's passages in order, labelled with the anonymised letters. */
function renderBlock(block: AnalysisQuestionBlock): string {
  const lines = block.positions.map(
    (p) => `Respondent ${p.respondent}: ${p.text}`,
  );
  return `Question: ${block.questionText}\n${lines.join("\n")}`;
}

/** The user turn: a short framing, then each question's labelled positions. */
export function buildAnalysisMessages(
  ctx: AnalysisRequestContext,
  systemPrompt: string = ANALYSIS_SYSTEM_PROMPT,
): AnalysisMessages {
  const intro =
    ctx.scope === "question"
      ? "The founders answered this question. Each position is stated in the respondent's own words.\n\n"
      : "The founders answered the strategy questionnaire. Each position is stated in the respondent's own words.\n\n";
  const body = ctx.blocks.map(renderBlock).join("\n\n");
  return {
    system: systemPrompt,
    messages: [{ role: "user", content: `${intro}${body}` }],
    tools: [ANALYSIS_RESULT_TOOL],
    tool_choice: { type: "tool", name: ANALYSIS_RESULT_TOOL_NAME },
  };
}

/** A model response that did not contain the forced structured output. */
export class MalformedAnalysisOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MalformedAnalysisOutputError";
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function parseConflict(input: unknown): { between: string; positions: string[] } {
  const o = asRecord(input);
  if (
    o === null ||
    typeof o.between !== "string" ||
    !Array.isArray(o.positions) ||
    !o.positions.every((p) => typeof p === "string") ||
    o.positions.length === 0
  ) {
    throw new MalformedAnalysisOutputError(
      "conflict must carry between and non-empty string positions",
    );
  }
  return { between: o.between, positions: o.positions as string[] };
}

function parseAnalysisResult(input: unknown): AnalysisOutput {
  const o = asRecord(input);
  if (o === null) {
    throw new MalformedAnalysisOutputError("analysis_result input is not an object");
  }
  if (typeof o.agreement !== "string") {
    throw new MalformedAnalysisOutputError("agreement must be a string");
  }
  if (!Array.isArray(o.conflicts)) {
    throw new MalformedAnalysisOutputError("conflicts must be an array");
  }
  if (
    !Array.isArray(o.askInRoom) ||
    !o.askInRoom.every((q) => typeof q === "string")
  ) {
    throw new MalformedAnalysisOutputError("askInRoom must be an array of strings");
  }
  const note = o.wordingNote;
  if (note !== null && note !== undefined && typeof note !== "string") {
    throw new MalformedAnalysisOutputError("wordingNote must be a string or null");
  }
  return {
    agreement: o.agreement,
    conflicts: o.conflicts.map(parseConflict),
    askInRoom: o.askInRoom as string[],
    wordingNote: typeof note === "string" ? note : null,
  };
}

/**
 * Turn a model response into an `AnalysisOutput`.
 *
 * Accepts either the raw Anthropic Messages body (a forced `analysis_result`
 * tool_use block) or a JSON string (the serialized tool input the provider
 * returns). Anything else — a plain free-text reply, a missing tool call, a
 * malformed shape — throws `MalformedAnalysisOutputError` rather than guessing,
 * because there is no §5.4 guard downstream: the parser is the boundary, so a
 * response that does not have the four-field shape is impossible here.
 */
export function parseAnalysisResponse(data: unknown): AnalysisOutput {
  if (typeof data === "string") {
    let json: unknown;
    try {
      json = JSON.parse(data) as unknown;
    } catch {
      throw new MalformedAnalysisOutputError("analysis output is not valid JSON");
    }
    return parseAnalysisResult(json);
  }

  const body = asRecord(data);
  const contentBlocks = Array.isArray(body?.content) ? body.content : [];
  for (const block of contentBlocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== ANALYSIS_RESULT_TOOL_NAME) continue;
    return parseAnalysisResult(b.input);
  }
  throw new MalformedAnalysisOutputError(
    `no ${ANALYSIS_RESULT_TOOL_NAME} tool call in the model response`,
  );
}