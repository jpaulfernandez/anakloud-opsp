import { describe, expect, it } from "vitest";
import {
  buildCoachMessages,
  CoachMessages,
  COACH_RESULT_TOOL,
  COACH_RESULT_TOOL_NAME,
  COACH_SYSTEM_PROMPT,
  MalformedCoachOutputError,
  parseCoachResponse,
  type CoachOutput,
} from "../../lib/coach-prompt";
import {
  blockedTerms,
  coachOutputViolations,
} from "../../lib/coach-containment";
import { COACH_FIXTURES } from "../../lib/coach-fixtures";
import { QUESTION_MAP } from "../../lib/questions";

// F13-T01 — the coach prompt and structured output (tech_infrastructure.md
// §5.2, §5.3). The three acceptance criteria map onto three guarantees:
//
//   - "structured output mode is enforced; free-text responses are impossible"
//     — the tool schema forces the model into a coach_result call, and the
//     parser refuses anything but a well-formed coach_result;
//   - "a vague fixture answer produces a form-level hint containing no domain
//     noun" — the prompt forbids domain nouns so the model never proposes one,
//     and the shared guard (F13-T03) is what actually rejects one if it does;
//   - "verdict: ok never arrives with a non-empty hint" — the schema says
//     `hint` is empty when ok, and the shared guard trips any ok+non-empty.
//
// The model side of the second criterion (actually producing clean hints across
// all 30 fixtures) is the live T1 run — scripts/coach-containment.ts. Everything
// assertable offline is asserted here, and this suite shares the same
// lib/coach-prompt.ts and lib/coach-containment.ts modules, so the two halves
// cannot drift apart.

/** The one allowed form-level hint shape §6.2 gives as an example. */
const FORM_LEVEL_HINT =
  "What would you point at to show this happened?";

function needsWork(hint: string, example = ""): CoachOutput {
  return { verdict: "needs_work", dimension: "measurability", hint, example };
}

describe("structured output mode is enforced (acceptance 1)", () => {
  // The `as const` tool is deeply readonly; the casts go through `unknown` so
  // the assertions read the schema's shape without tripping the mutable cast.
  const schema = COACH_RESULT_TOOL.input_schema as unknown as {
    properties: {
      verdict: { enum: string[] };
      dimension: { enum: Array<string | null> };
      hint: { description?: string };
    };
    required: string[];
  };

  it("the tool schema requires exactly the §5.3 fields", () => {
    expect(schema.required.toSorted()).toEqual([
      "dimension", "example", "hint", "verdict",
    ]);
    for (const field of ["verdict", "dimension", "hint", "example"]) {
      expect(Object.keys(schema.properties), field).toContain(field);
    }
  });

  it("verdict and dimension are closed enums, so the model cannot improvise", () => {
    expect(schema.properties.verdict.enum).toEqual(["ok", "needs_work"]);
    expect(schema.properties.dimension.enum).toEqual([
      "measurability", "specificity", "single_answer", "too_short", null,
    ]);
  });

  it("the request forces the coach_result tool in tool-use mode", () => {
    const coach: CoachMessages = buildCoachMessages({
      questionId: "q3",
      questionText: "Question",
      helper: "Helper",
      answer: "Answer text.",
      exampleRequested: false,
    });
    // tool_choice.type === "tool" with the tool name is what makes free text
    // impossible at the API — the model must call coach_result.
    expect(coach.tools).toHaveLength(1);
    expect(coach.tool_choice).toEqual({
      type: "tool",
      name: COACH_RESULT_TOOL_NAME,
    });
  });

  it("parses a forced coach_result tool call into the §5.3 shape", () => {
    const response = {
      content: [
        { type: "text", text: "I considered this answer." },
        {
          type: "tool_use",
          id: "call_1",
          name: COACH_RESULT_TOOL_NAME,
          input: {
            verdict: "needs_work",
            dimension: "too_short",
            hint: "Too short to interpret.",
            example: "",
          },
        },
      ],
    };
    expect(parseCoachResponse(response)).toEqual({
      verdict: "needs_work",
      dimension: "too_short",
      hint: "Too short to interpret.",
      example: "",
    });
  });

  it("parses the serialised JSON string the provider returns", () => {
    const providerText = JSON.stringify({
      verdict: "ok",
      dimension: null,
      hint: "",
      example: "",
    });
    expect(parseCoachResponse(providerText)).toEqual({
      verdict: "ok",
      dimension: null,
      hint: "",
      example: "",
    });
  });

  it("rejects a plain free-text reply with no tool call", () => {
    // A chatty plain-text response, exactly what tool-use mode exists to forbid.
    const freeText = { content: [{ type: "text", text: "Your answer looks fine." }] };
    expect(() => parseCoachResponse(freeText)).toThrow(MalformedCoachOutputError);
  });

  it("rejects an empty object, a bare string, and a tool_use for another tool", () => {
    expect(() => parseCoachResponse({})).toThrow(MalformedCoachOutputError);
    expect(() => parseCoachResponse("gobbledygook")).toThrow(MalformedCoachOutputError);
    expect(
      () =>
        parseCoachResponse({
          content: [
            { type: "tool_use", name: "some_other_tool", input: { verdict: "ok" } },
          ],
        }),
    ).toThrow(/no coach_result tool call/);
  });

  it("rejects malformed coach_result input (bad verdict or dimension)", () => {
    const withBadVerdict = {
      content: [
        { type: "tool_use", name: COACH_RESULT_TOOL_NAME, input: { verdict: "great" } },
      ],
    };
    expect(() => parseCoachResponse(withBadVerdict)).toThrow("invalid verdict");

    const withBadDimension = {
      content: [
        {
          type: "tool_use",
          name: COACH_RESULT_TOOL_NAME,
          input: { verdict: "needs_work", dimension: "length", hint: "x", example: "" },
        },
      ],
    };
    expect(() => parseCoachResponse(withBadDimension)).toThrow("invalid dimension");
  });
});

describe("a vague fixture draws a form-level hint with no domain noun (acceptance 2)", () => {
  // The offline, deterministic half of this acceptance. The model producing
  // actually-clean hints across every fixture is the job of the live T1 run;
  // what this suite proves is (a) the prompt forbids the domains, (b) the
  // system's own strings stay clean, and (c) a compliant form-level hint passes
  // the guard while a leaking one is caught here before any browser could see it.

  it("the system prompt forbids suggesting content: metric, number, customer, model, priority, risk, product, value", () => {
    // The §6.2/§5.2 MUST NOT list, asserted so a prompt edit cannot silently
    // remove one of the content prohibitions it supposedly states.
    for (const token of [
      "metric", "number", "customer type", "business model",
      "priority", "risk", "product", "value",
    ]) {
      expect(COACH_SYSTEM_PROMPT.toLowerCase(), token).toContain(token);
    }
  });

  it("the system prompt forbids the prohibited domains the women guard enforces", () => {
    // Every named domain the model must never echo into a hint: healthcare,
    // therapy, clinics, doctors, patients, parents, children, schools,
    // teachers, software products.
    for (const token of [
      "healthcare", "therapy", "clinics", "doctors", "patients",
      "parents", "children", "schools", "teachers", "software",
    ]) {
      expect(COACH_SYSTEM_PROMPT.toLowerCase(), token).toContain(token);
    }
  });

  it("the user turn for a vague fixture carries question metadata and exactly the one answer", () => {
    const fixture = COACH_FIXTURES.find((f) => f.id === "f1")!; // Q3 "A lot more kids…"
    const q = QUESTION_MAP[fixture.questionId];
    const message = buildCoachMessages({
      questionId: fixture.questionId,
      questionText: q.text,
      helper: q.helper,
      answer: fixture.answer,
      exampleRequested: false,
    }).messages[0].content;

    expect(message).toContain(`Question: ${q.text}`);
    expect(message).toContain(`Helper: ${q.helper}`);
    expect(message).toContain(`Answer:\n${fixture.answer}`);

    // The fixed parts the system itself contributes must not themselves leak a
    // domain noun (the answer text is the respondent's and is exempt — it is
    // the input, not the hint).
    expect(blockedTerms(COACH_RESULT_TOOL.description)).toEqual([]);
    expect(blockedTerms(FORM_LEVEL_HINT)).toEqual([]);
  });

  it("an allowed form-level hint passes the guard; a domain-noun one is caught", () => {
    // The shape §6.2 permits for a vague answer:
    expect(coachOutputViolations(needsWork(FORM_LEVEL_HINT))).toEqual([]);

    // The negative control: however the model phrased it, a hint that ends up
    // naming a child/centre/app is rejected before it reaches a browser.
    expect(coachOutputViolations(needsWork("Measure how many children you enroll."))).not.toEqual([]);
    expect(coachOutputViolations(needsWork("Audit how many centres sign up."))).not.toEqual([]);
    expect(coachOutputViolations(needsWork("Count how many use the app."))).not.toEqual([]);
  });
});

describe("verdict: ok never arrives with a non-empty hint (acceptance 3)", () => {
  it("the schema states that hint is empty when ok", () => {
    const hint = (COACH_RESULT_TOOL.input_schema as unknown as {
      properties: { hint: { description?: string } };
    }).properties.hint;
    expect(hint.description).toContain("empty when ok");
  });

  it("an ok verdict parses with an empty hint and is clean", () => {
    const parsed: CoachOutput = parseCoachResponse(
      JSON.stringify({ verdict: "ok", dimension: null, hint: "", example: "" }),
    );
    expect(parsed.verdict).toBe("ok");
    expect(parsed.hint).toBe("");
    expect(coachOutputViolations(parsed)).toEqual([]);
  });

  it("an ok verdict carrying any hint is tripped by the shared guard", () => {
    // Not this module's parse (the parser faithfully returns what the model
    // sent), but the §5.4 guard — applied before any response reaches the
    // browser — discards it. The guard and the prompt share one module, so the
    // "never arrives" is enforced at the same boundary T1 asserts on.
    expect(
      coachOutputViolations({ verdict: "ok", hint: "Great answer." }),
    ).toContain('verdict "ok" carries a non-empty hint');
  });
});