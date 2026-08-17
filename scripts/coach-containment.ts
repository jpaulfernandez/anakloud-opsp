// T1 coach-containment — the LIVE half of F11-T04 (tech_infrastructure.md §8,
// spec.md §10 criterion 8), re-run against Gemini by F20-T01 / M12.
//
// This is the M12 migration gate. It runs every coach-containment fixture AND
// every synthetic candid-risk (pre-mortem / walk-away) fixture through the
// coach at L0 — a real model call — and asserts that no hint or example leaks a
// banned term, no hint carries a digit, and no hint exceeds 25 words. The
// safety fixtures (lib/safety-fixtures.ts) exercise the M08 safety risk: their
// candid-risk language is the kind of turn Gemini is most likely to refuse.
// They are synthetic and carry no `q14d` label, no real answer, identity,
// respondent ID, or private metadata (spec.md §8) — asserted by the offline
// suite — and the harness sends them exactly as it would from production: the
// question metadata plus the one answer under evaluation.
//
// Deliberately NOT part of `./verify.sh`. It costs money, flakens on latency,
// and requires a key, so it runs only on demand (F11-T04 / F20-T01 "SHALL NOT
// include the live-model portion in the default verify.sh run"). Run it
// whenever the coach prompt or the static hint set changes:
//
//   npm run test:coach-containment
//
// It requires GEMINI_API_KEY and AI_MODEL to be set and drives L0 directly
// (it ignores AI_LEVEL_PIN — the whole point is that the healthy-level output
// is what must stay contained). It uses the spec'd §5.2 system prompt and §5.3
// structured output, and applies the same containment module the offline unit
// test uses, so the two halves of T1 can never disagree about what a trip is.
// At the end it prints the M12 run record (pinned model, run date, fixture
// count, guard-trip count, baseline comparison) so the Gemini result can be
// compared with the accepted Anthropic baseline (F20-T01).
//
// Note on the transport: the harness cannot import lib/provider.ts — the
// F12-T01 scan forbids any module but the gateway from doing so — so it drives
// the Gemini endpoint directly with fetch, mirroring exactly what
// `geminiProvider` sends (systemInstruction / contents / functionDeclarations /
// toolConfig mode ANY) and parsing the same `functionCall.args` shape. The
// prompt and output schema still come from the shared lib/coach-prompt.ts, so a
// prompt or schema change is automatically re-exercised by the next run.
//
// Exit codes: 0 = all fixtures contained; 1 = at least one leak; 2 = the harness
// could not run (missing env or API error).

import {
  COACH_FIXTURES,
  type CoachableQuestionId,
} from "../lib/coach-fixtures";
import {
  ANTHROPIC_BASELINE_GUARD_TRIPS,
  coachOutputViolations,
  formatRunRecord,
  runFixtureCount,
  type ContainmentRunRecord,
} from "../lib/coach-containment";
import {
  buildCoachMessages,
  COACH_RESULT_TOOL,
  parseCoachResponse,
  type CoachOutput,
} from "../lib/coach-prompt";
import { SAFETY_FIXTURES, type SafetyFixture } from "../lib/safety-fixtures";
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

interface RunFixture {
  id: string;
  questionId: CoachableQuestionId;
  label: string;
  answer: string;
}

const SAFETY_AS_FIXTURES: RunFixture[] = SAFETY_FIXTURES.map(
  (f: SafetyFixture) => ({
    id: f.id,
    questionId: f.questionId,
    label: f.label,
    answer: f.answer,
  }),
);

const RUN_FIXTURES: RunFixture[] = [
  ...COACH_FIXTURES.map((f) => ({
    id: f.id,
    questionId: f.questionId,
    label: f.label,
    answer: f.answer,
  })),
  ...SAFETY_AS_FIXTURES,
];

async function callCoachGemini(
  apiKey: string,
  model: string,
  fixture: RunFixture,
): Promise<CoachOutput> {
  const q = QUESTION_MAP[fixture.questionId];
  const coach = buildCoachMessages({
    questionId: fixture.questionId,
    questionText: q.text,
    helper: q.helper,
    answer: fixture.answer,
    exampleRequested: false,
  });
  // Mirrors geminiProvider's request mapping (F18-T01 / M06): system prompt to
  // systemInstruction, the single user turn to contents, the forced function
  // via functionDeclarations + toolConfig mode ANY, output cap to
  // generationConfig.maxOutputTokens.
  const body = {
    systemInstruction: { parts: [{ text: coach.system }] },
    contents: [{ role: "user", parts: [{ text: coach.messages[0].content }] }],
    tools: [
      {
        functionDeclarations: [
          {
            name: COACH_RESULT_TOOL.name,
            description: COACH_RESULT_TOOL.description,
            parameters: COACH_RESULT_TOOL.input_schema,
          },
        ],
      },
    ],
    toolConfig: { functionCallingConfig: { mode: "ANY" } },
    generationConfig: { maxOutputTokens: 256 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API ${response.status}: ${detail.slice(0, 300)}`);
  }
  const parsed = (await response.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: {
        parts?: Array<{
          text?: string;
          functionCall?: { name?: string; args?: unknown };
        }>;
      };
    }>;
    promptFeedback?: { blockReason?: string };
  };

  // M08 / F18-T03 — a 200 may still be a safety block, distinct from an HTTP
  // error. On candid-risk language Gemini can refuse. There is nothing to
  // contain if it does, so surface it as a harness failure rather than
  // silently passing the fixture.
  const blockedReason =
    parsed.promptFeedback?.blockReason ??
    (parsed.candidates?.[0]?.finishReason === "SAFETY" ? "SAFETY" : undefined);
  if (blockedReason !== undefined) {
    throw new Error(`Gemini safety block: ${blockedReason}`);
  }

  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const structured = parts.find(
    (p) =>
      p.functionCall !== undefined &&
      p.functionCall.name === COACH_RESULT_TOOL.name,
  )?.functionCall?.args;
  if (structured === undefined) {
    throw new Error(
      `no ${COACH_RESULT_TOOL.name} function call in the model response`,
    );
  }
  return parseCoachResponse(JSON.stringify(structured));
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

  for (const fixture of RUN_FIXTURES) {
    let input: CoachOutput;
    try {
      input = await callCoachGemini(apiKey, model, fixture);
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
    process.stdout.write(
      `[${fixture.id}/${RUN_FIXTURES.length}] ${fixture.questionId} ${fixture.label} ... ${violations.length === 0 ? "contained" : "LEAK"}\n`,
    );
  }

  // M12 run record — model, run date, fixture count, guard-trip count, and the
  // comparison with the accepted Anthropic baseline. Printed to stderr when the
  // run fails so it survives the non-zero exit, and to stdout on success.
  const record: ContainmentRunRecord = {
    model,
    runDate: new Date().toISOString(),
    coachFixtureCount: COACH_FIXTURES.length,
    safetyFixtureCount: SAFETY_FIXTURES.length,
    guardTripCount: failures.length,
  };
  const recordText = formatRunRecord(record);
  if (failures.length > 0) {
    console.error(`\nT1 FAILED: ${failures.length} of ${runFixtureCount(record)} fixtures leaked content.`);
    for (const failure of failures) {
      console.error(`\n- [${failure.fixtureId}] ${failure.question} (${failure.label})`);
      for (const violation of failure.violations) console.error(`    ${violation}`);
      console.error(`    hint: "${failure.hint}"`);
      if (failure.example) console.error(`    example: "${failure.example}"`);
    }
    console.error("\nA tripped guard like this must never be papered over — fix the prompt or the model, then re-run.");
    console.error(`\n${recordText}`);
    process.exit(1);
  }

  console.log(`\nT1 PASSED: all ${runFixtureCount(record)} fixtures contained at L0 (model ${model}).`);
  console.log(`\nRun record (${ANTHROPIC_BASELINE_GUARD_TRIPS}-trip Anthropic baseline):`);
  console.log(recordText);
}

main().catch((error) => {
  console.error(`T1 harness error: ${String(error)}`);
  process.exit(2);
});