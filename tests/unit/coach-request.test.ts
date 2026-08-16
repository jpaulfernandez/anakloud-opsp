import { describe, expect, it } from "vitest";
import {
  buildCoachMessages,
  type CoachRequestContext,
} from "../../lib/coach-prompt";

// F13-T02 — the outbound payload shape that lib/coach-request.ts feeds. The
// DB-backed loader is tested in coach-request.integration.test.ts; this suite
// pins the offline half of the same guarantees on the payload builder itself:
//
//   - "a test captures the outbound payload and asserts absence of name, id,
//     email and any second answer" — the message carry exactly the question
//     metadata and the one answer supplied, nothing else;
//   - "each coach call is stateless and sees exactly one answer" — every call
//     builds a fresh single user message; two calls share no conversational
//     state.

/** A plausible-but-fictional identity a leaked payload would carry. */
const IDENTITY = {
  name: "Maria Dela Cruz",
  email: "maria@anakloud.ph",
  id: "66666666-6666-6666-6666-666666666666",
} as const;

/** A different answer that must never leak into this call's payload. */
const OTHER_ANSWER =
  "A completely different answer about centres and therapists that is not this one.";

const CONTEXT: CoachRequestContext = {
  questionId: "q3",
  questionText: "The number that would prove it worked",
  helper: "Name the metric, then give the value. Then one line: why that number and not another?",
  answer: "A lot more kids get real help than today.",
  exampleRequested: false,
};

/** The concatenated user-turn text — the part of the payload carrying content. */
function userTurn(ctx: CoachRequestContext): string {
  return buildCoachMessages(ctx).messages[0].content;
}

describe("coach payload minimisation (offline half)", () => {
  it("carries exactly the one answer and question metadata, and no identity or second answer", () => {
    const payload = userTurn(CONTEXT);

    // Question metadata and the one answer under evaluation.
    expect(payload).toContain(`Question: ${CONTEXT.questionText}`);
    expect(payload).toContain(`Helper: ${CONTEXT.helper}`);
    expect(payload).toContain(`Answer:\n${CONTEXT.answer}`);

    // Nothing that would identify or widen the respondent.
    for (const secret of [IDENTITY.name, IDENTITY.email, IDENTITY.id, OTHER_ANSWER]) {
      expect(payload, secret).not.toContain(secret);
    }
  });

  it("sends a single user message per call and no conversational history", () => {
    const messages = buildCoachMessages(CONTEXT).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("two consecutive calls share no state — each builds an independent payload", () => {
    const first = buildCoachMessages(CONTEXT);
    const second = buildCoachMessages({ ...CONTEXT, answer: "Changed after edit." });

    // The second call sees only its own single message, not the first's answer
    // appended anywhere — no accumulation of prior turns.
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].content).toContain("Answer:\nChanged after edit.");
    expect(second.messages[0].content).not.toContain(CONTEXT.answer);

    // Independence is per-call: repeating the same context yields identical,
    // self-contained messages, not a growing thread.
    const again = buildCoachMessages(CONTEXT);
    expect(again.messages[0].content).toBe(first.messages[0].content);
    expect(again.messages).toHaveLength(1);
  });
});