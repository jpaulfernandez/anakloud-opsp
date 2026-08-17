import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRE_MORTEM_MARKERS,
  SAFETY_FIXTURES,
  WALK_AWAY_MARKERS,
  type SafetyFixture,
} from "../../lib/safety-fixtures";
import { buildCoachProviderRequest, coachResponseFromResult } from "../../lib/coach-endpoint";
import { callProvider, type AIProvider, type GatewayContext } from "../../lib/ai-gateway";
import { geminiProvider } from "../../lib/provider";
import { QUESTION_MAP } from "../../lib/questions";
import { STATIC_HINTS } from "../../lib/static-hints";
import type { CoachRequestContext } from "../../lib/coach-prompt";

// F18-T03 (source item M08, acceptance 4) — the synthetic candid-risk
// fixtures genuinely exercise the *safety* path, and they are synthetic. These
// tests do two jobs:
//
//   1. Prove each fixture carries its register (pre-mortem / walk-away) and
//      contains no private-row fingerprint — no `q14d` label, no respondent id
//      or identity, no email, no invite/cohort metadata — so COVERAGE.md's
//      resolution ("synthetic walk-away-language fixtures that contain no
//      database-derived answer, q14d label, identity, respondent ID, or private
//      metadata") is enforced by code, not by good intentions.
//
//   2. Drive every fixture's answer through the real provider → gateway path
//      with a faked Gemini safety block, and assert the respondent-facing L2
//      outcome (M08 acceptance 1), zero retries (acceptance 3), and the
//      distinct block reason recorded on the result.

/** The coach request context for a fixture, using the real question copy. */
function coachCtxFor(f: SafetyFixture): CoachRequestContext {
  const q = QUESTION_MAP[f.questionId];
  return {
    questionId: f.questionId,
    questionText: q.text,
    helper: q.helper,
    answer: f.answer,
    exampleRequested: false,
  };
}

/** A gateway context that will attempt the provider and retry nothing. */
function gatewayCtx(): GatewayContext {
  return {
    purpose: "coach",
    pin: "auto",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    retryBackoffMs: 0,
    timeoutMs: 60,
  };
}

/** A faked Gemini 200 that carries a SAFETY-finished candidate and no content. */
function safetyFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({
        candidates: [{ finishReason: "SAFETY", index: 0 }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 0 },
      }),
      { status: 200 },
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the safety fixtures exist and are synthetic (spec.md §8)", () => {
  it("cover both the pre-mortem and the walk-away register", () => {
    const kinds = SAFETY_FIXTURES.map((f) => f.kind);
    expect(kinds).toContain("pre_mortem");
    expect(kinds).toContain("walk_away");
  });

  it("each answer carries its register's marker", () => {
    for (const f of SAFETY_FIXTURES) {
      const markers =
        f.kind === "pre_mortem" ? PRE_MORTEM_MARKERS : WALK_AWAY_MARKERS;
      const text = f.answer.toLowerCase();
      expect(
        markers.some((m) => text.includes(m)),
        `${f.id} should read as ${f.kind}`,
      ).toBe(true);
    }
  });

  it("contain no q14d label, respondent identity, email, or invite/cohort metadata", () => {
    // The mechanical encoding of COVERAGE.md's privacy resolution: none of the
    // answers or their metadata may finger a real private row, a respondent, an
    // invite token, or a cohort.
    const forbidden = [
      "q14d",
      "private",
      "respondent",
      "invite",
      "cohort",
      "resume",
      "@",
      "mailto:",
    ];
    for (const f of SAFETY_FIXTURES) {
      const haystack = `${f.id} ${f.label} ${f.questionId} ${f.answer}`.toLowerCase();
      for (const term of forbidden) {
        expect(haystack, `${f.id} must not contain "${term}"`).not.toContain(term);
      }
      // No uuid-shaped respondent id, no email-shaped string.
      expect(f.answer).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      expect(f.answer).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    }
  });

  it("target only coachable questions, so a turn travels in the coach shape", () => {
    for (const f of SAFETY_FIXTURES) {
      const q = QUESTION_MAP[f.questionId];
      expect(q.coachable, `${f.questionId} is a coachable question`).toBe(true);
    }
  });
});

describe("each fixture exercises the safety path to a deterministic L2 card", () => {
  it.each(SAFETY_FIXTURES)(
    "$id ($kind) — a Gemini safety block degrades once, with no retry",
    async (f) => {
      const fetchMock = safetyFetchMock();
      vi.stubGlobal("fetch", fetchMock);

      const provider: AIProvider = geminiProvider("test-key");
      const result = await callProvider(
        gatewayCtx(),
        provider,
        buildCoachProviderRequest(coachCtxFor(f), "pinned-model"),
      );

      // F18-T03 acceptances 1 and 3: served at L2, and exactly one provider
      // request — never retried, because the input will not change.
      expect(result.level).toBe("L2");
      expect(result.degraded).toBe(true);
      expect(result.blockedReason).toBe("SAFETY");
      expect(fetchMock.mock.calls).toHaveLength(1);

      // The respondent-facing outcome is the ordinary static hint card — nothing
      // reveals a block (acceptance 1, PR6).
      const body = coachResponseFromResult(coachCtxFor(f), result);
      expect(body.level).toBe("L2");
      expect(body.verdict).toBe("needs_work");
      expect(body.hint).toBe(STATIC_HINTS[f.questionId].hint);
    },
  );
});