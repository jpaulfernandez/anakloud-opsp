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
// It requires GEMINI_API_KEY and AI_MODEL to be set and drives L0 directly
// (it ignores AI_LEVEL_PIN — the whole point is that the healthy-level output
// is what must stay contained). It uses the spec'd §5.2 system prompt and §5.3
// structured output, and applies the same containment module the offline unit
// test uses, so the two halves of T1 can never disagree about what a trip is.
//
// Exit codes: 0 = all fixtures contained; 1 = at least one leak; 2 = the harness
// could not run (missing env or API error).

import { COACH_FIXTURES } from "../lib/coach-fixtures";
import { coachOutputViolations } from "../lib/coach-containment";
import {
  buildCoachMessages,
  parseCoachResponse,
  type CoachOutput,
} from "../lib/coach-prompt";
import { QUESTION_MAP } from "../lib/questions";

// The coach prompt, the structured-output tool schema, the user-message builder
// and the response parser all live in ../lib/coach-prompt.ts and are shared with
// the production `/api/coach` path. The harness deliberately does NOT carry its
// own copy: that is what makes "changes tracked and re-tested against T1" real.
// Any edit to the §5.2 prompt or the §5.3 schema in lib/coach-prompt.ts is
// automatically re-exercised by the next run of this command.

interface Failure {
  fixtureId: string;
  question: string;
  label: string;
  hint: string;
  example: string;
  violations: string[];
}

async function callCoach(
  apiKey: string,
  model: string,
  fixture: (typeof COACH_FIXTURES)[number],
  requestId: number,
): Promise<CoachOutput> {
  const url = "https://api.anthropic.com/v1/messages";
  const q = QUESTION_MAP[fixture.questionId];
  const coach = buildCoachMessages({
    questionId: fixture.questionId,
    questionText: q.text,
    helper: q.helper,
    answer: fixture.answer,
    exampleRequested: false,
  });
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
      ...coach,
      metadata: { user_id: `coach-containment-fixture-${requestId}` },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 300)}`);
  }
  return parseCoachResponse(await response.json());
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.AI_MODEL;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. T1 live run refuses to start.");
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
    let input: CoachOutput;
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