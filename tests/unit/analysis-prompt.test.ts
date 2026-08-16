import { describe, expect, it } from "vitest";
import {
  ANALYSIS_RESULT_TOOL,
  ANALYSIS_RESULT_TOOL_NAME,
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisMessages,
  MalformedAnalysisOutputError,
  parseAnalysisResponse,
  type AnalysisOutput,
  type AnalysisRequestContext,
} from "../../lib/analysis-prompt";

// F14-T01 — the facilitator-analysis prompt and payload (tech_infrastructure
// §5.5, spec.md §6.4, FR-32). The acceptance criteria map onto offline
// assertions, mirroring F13-T01:
//
//   - "output for a hard-split fixture states both positions without picking
//     one" — §5.5 forbids benefiting a view, and the output schema has no field
//     for a winner, a rank or a recommendation; a hard-split response that
//     states both positions survives the parser verbatim, and the rendered
//     payload carries both labelled positions so the model can state them;
//   - "output includes 2-3 concrete questions to ask in the room" — the prompt
//     asks for 2-3 and `askInRoom` is a required array, so the model is forced
//     to produce them;
//   - the structured output requirement is shaped here: the schema forces the
//     four fields, free-text answers are impossible, and a malformed reply is
//     rejected rather than guessed.
//
// The facilitator facing → presenter folders must not leak names or ids: the
// context type carries only letters and text, so buildAnalysisMessages cannot
// render an identity even if one were handed in.

/** A problem-scope (single question) hard-split context without any identity. */
function hardSplitContext(): AnalysisRequestContext {
  return {
    scope: "question",
    questionId: "q8",
    blocks: [
      {
        questionId: "q8",
        questionText: "Which door opens first?",
        positions: [
          {
            respondent: "A",
            text: "pedconnect first: the referral is the scarce resource.",
          },
          {
            respondent: "B",
            text: "teachday first: centers hold the money and the daily pain.",
          },
        ],
      },
    ],
  };
}

describe("the analysis system prompt is verbatim §5.5", () => {
  it("asks the model to report, not decide, who is right", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("Report what the answers say.");
    expect(ANALYSIS_SYSTEM_PROMPT).toContain("Do not decide who is right.");
  });

  it("structures the output as agree / don't / ask in the room", () => {
    const prompt = ANALYSIS_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("where they agree");
    expect(prompt).toContain("where they don't");
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/2-3 specific questions/);
  });

  it("forbids recommending a strategy, merging, softening or ranking", () => {
    const prompt = ANALYSIS_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("never recommend a strategy");
    expect(prompt).toContain("never say which view is better");
    expect(prompt).toContain("never merge, soften, or rank the positions");
  });

  it("reserves the one permitted judgement — wording, not substance", () => {
    const prompt = ANALYSIS_SYSTEM_PROMPT.toLowerCase();
    expect(prompt).toContain("a difference in wording rather than");
    expect(prompt).toContain("that is the one judgement you may make");
  });
});

describe("the structured output schema enforces the §5.5 shape", () => {
  const schema = ANALYSIS_RESULT_TOOL.input_schema as unknown as {
    properties: Record<string, { type?: string | string[] }>;
    required: string[];
  };

  it("requires exactly the four §5.5 fields", () => {
    expect(schema.required.toSorted()).toEqual([
      "agreement",
      "askInRoom",
      "conflicts",
      "wordingNote",
    ]);
    for (const field of ["agreement", "conflicts", "askInRoom", "wordingNote"]) {
      expect(Object.keys(schema.properties), field).toContain(field);
    }
  });

  it("askInRoom is a required array, so the model must produce questions", () => {
    const askInRoom = schema.properties.askInRoom;
    expect(askInRoom.type).toContain("array");
    expect(schema.required).toContain("askInRoom");
  });

  it("the request forces the analysis_result tool in tool-use mode", () => {
    const messages = buildAnalysisMessages(hardSplitContext());
    expect(messages.tools).toHaveLength(1);
    expect(messages.tool_choice).toEqual({
      type: "tool",
      name: ANALYSIS_RESULT_TOOL_NAME,
    });
  });
});

describe("a hard-split fixture states both positions without picking one (acceptance)", () => {
  it("the rendered payload carries both positions, labelled, with no identity", () => {
    const userTurn = buildAnalysisMessages(hardSplitContext()).messages[0].content;

    // Both camps appear, each under their anonymised label and in own words.
    expect(userTurn).toContain("Respondent A: pedconnect first: the referral is the scarce resource.");
    expect(userTurn).toContain("Respondent B: teachday first: centers hold the money and the daily pain.");

    // Nothing else about a respondent exists to leak.
    expect(userTurn).not.toContain("@");
    expect(userTurn).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("parses a model reply that states both positions, preserving them verbatim", () => {
    const modelReply = JSON.stringify({
      agreement: "Both treat the referral as the scarce door.",
      conflicts: [
        {
          between: "A and B",
          positions: [
            "pedconnect first: the referral is the scarce resource.",
            "teachday first: centers hold the money and the daily pain.",
          ],
        },
      ],
      askInRoom: [
        "Who has watched a center turn down a warm referral?",
        "What would have to be true for the teachday-first path to be the wrong one?",
      ],
      wordingNote: null,
    });

    const output = parseAnalysisResponse(modelReply);
    expect(output.conflicts).toHaveLength(1);
    expect(output.conflicts[0].positions).toEqual([
      "pedconnect first: the referral is the scarce resource.",
      "teachday first: centers hold the money and the daily pain.",
    ]);
    expect(output.askInRoom).toHaveLength(2);
  });

  it("the output shape has no field in which to adjudicate", () => {
    // The schema is the modern boundary (§5.4's guard does not run for the
    // facilitator purposes): an output can only carry the four §5.5 things.
    const output = parseAnalysisResponse(
      JSON.stringify({
        agreement: "shared",
        conflicts: [{ between: "A and B", positions: ["first", "second"] }],
        askInRoom: ["Ask them which door they open tomorrow?"],
        wordingNote: null,
      }),
    ) as AnalysisOutput;
    expect(Object.keys(output).toSorted()).toEqual([
      "agreement",
      "askInRoom",
      "conflicts",
      "wordingNote",
    ]);
  });

  it("the one permitted judgement lands in wordingNote, not in a conflict as a rank", () => {
    const output = parseAnalysisResponse(
      JSON.stringify({
        agreement: "shared",
        conflicts: [{ between: "A and B", positions: ["one", "two"] }],
        askInRoom: ["Ask them what they each meant by 'sooner'."],
        wordingNote: "This looks like a difference in wording rather than substance.",
      }),
    );
    expect(output.wordingNote).toMatch(/wording rather than substance/);
  });
});

describe("the parser rejects anything that is not the §5.5 shape", () => {
  it("rejects a plain free-text reply with no tool call", () => {
    const freeText = { content: [{ type: "text", text: "Here is my analysis." }] };
    expect(() => parseAnalysisResponse(freeText)).toThrow(MalformedAnalysisOutputError);
  });

  it("rejects an empty object, a bare string, and a tool_use for another tool", () => {
    expect(() => parseAnalysisResponse({})).toThrow(MalformedAnalysisOutputError);
    expect(() => parseAnalysisResponse("gobbledygook")).toThrow(MalformedAnalysisOutputError);
    expect(() =>
      parseAnalysisResponse({
        content: [
          { type: "tool_use", name: "some_other_tool", input: { agreement: "x" } },
        ],
      }),
    ).toThrow(/no analysis_result tool call/);
  });

  it("rejects malformed analysis_result input", () => {
    // Not an array of positions.
    const badPositions = {
      content: [
        {
          type: "tool_use",
          name: ANALYSIS_RESULT_TOOL_NAME,
          input: {
            agreement: "x",
            conflicts: [{ between: "A", positions: "not an array" }],
            askInRoom: ["?"],
            wordingNote: null,
          },
        },
      ],
    };
    expect(() => parseAnalysisResponse(badPositions)).toThrow(/conflict/);

    // asks must be strings.
    const badAsks = {
      content: [
        {
          type: "tool_use",
          name: ANALYSIS_RESULT_TOOL_NAME,
          input: {
            agreement: "x",
            conflicts: [],
            askInRoom: [42],
            wordingNote: null,
          },
        },
      ],
    };
    expect(() => parseAnalysisResponse(badAsks)).toThrow(/askInRoom/);
  });
});