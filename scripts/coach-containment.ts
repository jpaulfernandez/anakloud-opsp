// T1 coach-containment — the LIVE half of F11-T04 (tech_infrastructure.md §8,
// spec.md §10 criterion 8). This is the P2 release gate: it runs the 30
// fixtures through the coach at L0 — a real model call — and asserts that no
// hint or example leaks a banned term, no hint carries a digit, and no hint
// exceeds 25 words.
//
// Deliberately NOT part of `./verify.sh`. It costs money, flakens on latency,
// and requires a key, so it runs only on demand (F11-T04 "SHALL NOT include the
// live-model portion in the default verify.sh run"). Run it whenever the coach
// prompt or the static hint set changes:
//
//   npm run test:coach-containment
//
// It requires ANTHROPIC_API_KEY and AI_MODEL to be set and drives L0 directly
// (it ignores AI_LEVEL_PIN — the whole point is that the healthy-level output
// is what must stay contained). It uses the spec'd §5.2 system prompt and §5.3
// structured output, and applies the same containment module the offline unit
// test uses, so the two halves of T1 can never disagree about what a trip is.
//
// Exit codes: 0 = all fixtures contained; 1 = at least one leak; 2 = the harness
// could not run (missing env or API error).

import {
  COACH_FIXTURES,
  type CoachableQuestionId,
} from "../lib/coach-fixtures";
import { coachOutputViolations } from "../lib/coach-containment";
import { QUESTION_MAP } from "../lib/questions";

// The coach system prompt, verbatim from tech_infrastructure.md §5.2. This is
// the "every change to a prompt" hook the ticket names: any edit to this (or
// to the §5.2 prompt in the codebase) should be followed by this command.
const SYSTEM_PROMPT = `
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

// Output the coach is forced to produce (a tool call), matching §5.3.
const RESULT_TOOL_NAME = "coach_result";
const RESULT_TOOL = {
  name: RESULT_TOOL_NAME,
  description: "The coach's structured verdict on one answer, per spec §5.3.",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["ok", "needs_work"] },
      dimension: {
        type: ["string", "null"],
        enum: ["measurability", "specificity", "single_answer", "too_short", null],
      },
      hint: { type: "string", description: "≤25 words, empty when ok" },
      example: { type: "string", description: "neutral domain, only when requested, else empty" },
    },
    required: ["verdict", "dimension", "hint", "example"],
  },
};

interface CoachInput {
  verdict: string;
  dimension: string | null;
  hint: string;
  example: string;
}

interface Failure {
  fixtureId: string;
  question: string;
  label: string;
  hint: string;
  example: string;
  violations: string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Extract the forced coach_result tool input from an Anthropic response. */
function parseCoachInput(data: unknown): CoachInput {
  const body = asRecord(data);
  const content = body?.content;
  const blocks = Array.isArray(content) ? content : [];
  for (const block of blocks) {
    const b = asRecord(block);
    if (b?.type !== "tool_use" || b?.name !== RESULT_TOOL_NAME) continue;
    const input = asRecord(b?.input);
    const verdict = asString(input?.verdict) || "needs_work";
    const dimension = typeof input?.dimension === "string" ? asString(input?.dimension) : null;
    const hint = asString(input?.hint);
    const example = asString(input?.example);
    return { verdict, dimension, hint, example };
  }
  throw new Error(`no ${RESULT_TOOL_NAME} tool call in the model response`);
}

function questionContext(id: CoachableQuestionId): string {
  const q = QUESTION_MAP[id];
  return `Question: ${q.text}\nHelper: ${q.helper}`;
}

async function callCoach(
  apiKey: string,
  model: string,
  fixture: (typeof COACH_FIXTURES)[number],
  requestId: number,
): Promise<CoachInput> {
  const url = "https://api.anthropic.com/v1/messages";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "output-128k-2025-02-19",
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${questionContext(fixture.questionId)}\n\nAnswer:\n${fixture.answer}`,
        },
      ],
      tools: [RESULT_TOOL],
      tool_choice: { type: "tool", name: RESULT_TOOL_NAME },
      metadata: { user_id: `coach-containment-fixture-${requestId}` },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 300)}`);
  }
  return parseCoachInput(await response.json());
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model = process.env.AI_MODEL;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set. T1 live run refuses to start.");
    process.exit(2);
  }
  if (!model) {
    console.error(
      "AI_MODEL is not set. Pin an explicit model id (never an alias) before running T1.",
    );
    process.exit(2);
  }

  const failures: Failure[] = [];
  let requestId = 0;

  for (const fixture of COACH_FIXTURES) {
    requestId += 1;
    let input: CoachInput;
    try {
      input = await callCoach(apiKey, model, fixture, requestId);
    } catch (error) {
      console.error(`[${fixture.id}] ${fixture.label}: ${String(error)}`);
      process.exit(2);
    }
    const violations = coachOutputViolations(input);
    if (violations.length > 0) {
      failures.push({
        fixtureId: fixture.id,
        question: fixture.questionId,
        label: fixture.label,
        hint: input.hint,
        example: input.example,
        violations,
      });
    }
    process.stdout.write(`[${fixture.id}/${COACH_FIXTURES.length}] ${fixture.questionId} ${fixture.label} ... ${violations.length === 0 ? "contained" : "LEAK"}\n`);
  }

  if (failures.length > 0) {
    console.error(`\nT1 FAILED: ${failures.length} of ${COACH_FIXTURES.length} fixtures leaked content.`);
    for (const failure of failures) {
      console.error(`\n- [${failure.fixtureId}] ${failure.question} (${failure.label})`);
      for (const violation of failure.violations) console.error(`    ${violation}`);
      console.error(`    hint: "${failure.hint}"`);
      if (failure.example) console.error(`    example: "${failure.example}"`);
    }
    console.error("\nA tripped guard like this must never be papered over — fix the prompt or the model, then re-run.");
    process.exit(1);
  }

  console.log(`\nT1 PASSED: all ${COACH_FIXTURES.length} fixtures contained at L0 (model ${model}).`);
}

main().catch((error) => {
  console.error(`T1 harness error: ${String(error)}`);
  process.exit(2);
});