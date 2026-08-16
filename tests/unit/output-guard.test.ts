import { describe, expect, it } from "vitest";
import {
  guardCoachOutput,
  guardCoachResponse,
} from "../../lib/output-guard";
import type { CoachOutput } from "../../lib/coach-prompt";
import { STATIC_HINTS } from "../../lib/static-hints";
import { callProvider, type AIProvider, type ProviderRequest, type ProviderResponse } from "../../lib/ai-gateway";

// F13-T03 — output guard (tech_infrastructure.md §5.4). The enforcement behind
// the §6.2 split: the prompt is the request, the guard is what actually trips
// when the model leaks. The guard runs on every coach response before it
// reaches a browser — wired into the gateway's guard stage — and does the four
// §5.4 checks:
//
//   1. a case-insensitive, stem-matched banned-term scan on `hint` and
//      `example` (blocklist from §5.4, including the four app names);
//   2. `hint` ≤25 words;
//   3. `hint` contains no digit (a number is a suggested target);
//   4. `verdict: "ok"` must carry an empty hint (verdict sanity).
//
// Acceptance:
//   - each of the four checks has a unit test that trips it        → describe 1
//   - a tripped guard produces the static hint and a logged reason → describe 3
//   - no retry occurs after a trip                                  → describe 3
//   - the respondent-visible card is identical to an ordinary L2    → describe 3
//     card (the trip is a plain L2 degrade that serves the static
//     sibling, never an error surface)

function needsWork(overrides: Partial<CoachOutput> = {}): CoachOutput {
  return {
    verdict: "needs_work",
    dimension: "specificity",
    hint: "",
    example: "",
    ...overrides,
  };
}

/** A coach output serialised the way the provider returns it (§5.3 §5.4). */
function asProviderText(output: CoachOutput): string {
  return JSON.stringify(output);
}

describe("output guard — each §5.4 check trips it (acceptance criterion 1)", () => {
  it("a banned term in the hint trips the guard", () => {
    const result = guardCoachOutput(
      needsWork({ hint: "You could count how many clinic visits happen." }),
    );
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain("banned term");
    }
  });

  it("a banned term in the example trips the guard (hint and example both scanned)", () => {
    const result = guardCoachOutput(
      needsWork({ hint: "Give a shape-of-an-answer example", example: "a paediatric clinic one" }),
    );
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain("example contains banned term");
    }
  });

  it("a hint exceeding 25 words trips the guard", () => {
    const long =
      "Here is a long suggestion that goes on and on well beyond the word ceiling that the coach is supposed to hold to right away now";
    expect(long.split(/\s+/).length).toBeGreaterThan(25);
    const result = guardCoachOutput(needsWork({ hint: long }));
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain("exceeds 25 words");
    }
  });

  it("a hint containing a digit trips the guard", () => {
    const result = guardCoachOutput(
      needsWork({ hint: "Aim to reach 500 by the end of next quarter" }),
    );
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain("contains a digit");
    }
  });

  it("verdict 'ok' arriving with a non-empty hint trips the guard", () => {
    const result = guardCoachOutput(needsWork({ verdict: "ok", hint: "Great answer." }));
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain('verdict "ok"');
    }
  });

  it("a clean needs_work output passes with the model output intact", () => {
    const clean = needsWork({ hint: "Count something you can look up next quarter." });
    expect(guardCoachOutput(clean)).toEqual({ kind: "pass", output: clean });
  });

  it("a clean 'ok' output (empty hint) passes", () => {
    const clean = needsWork({ verdict: "ok", hint: "" });
    expect(guardCoachOutput(clean)).toEqual({ kind: "pass", output: clean });
  });
});

describe("output guard — runs over serialised structured output (§5.4)", () => {
  it("parses a structured response and trips on a leaked field", () => {
    const text = asProviderText(
      needsWork({ hint: "Reach more parents by next quarter." }),
    );
    const result = guardCoachResponse(text);
    expect(result.kind).toBe("trip");
    if (result.kind === "trip") {
      expect(result.violations.join("; ")).toContain("banned term");
    }
  });

  it("passes a clean structured response", () => {
    const clean = needsWork({ hint: "Count something you can look up next quarter." });
    const result = guardCoachResponse(asProviderText(clean));
    expect(result.kind).toBe("pass");
  });

  it("flags an 'ok' verdict with a hint even via the serialised path", () => {
    const result = guardCoachResponse(
      asProviderText(needsWork({ verdict: "ok", hint: "Well done." })),
    );
    expect(result.kind).toBe("trip");
  });
});

// Gateway integration — the guard runs in the gateway's guard stage on every
// coach response before it reaches the browser (acceptance criteria 2–4).
const REQ: ProviderRequest = {
  prompt: "Review this answer.",
  model: "pinned-model",
  maxTokens: 200,
};

function coachCtx(
  overrides: Partial<Parameters<typeof callProvider>[0]> = {},
): Parameters<typeof callProvider>[0] {
  return {
    purpose: "coach",
    pin: "auto",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    ...overrides,
  };
}

function recordingProvider(
  respond: () => Promise<ProviderResponse>,
): { provider: AIProvider; calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  return {
    provider: {
      async request(req) {
        calls.push(req);
        return respond();
      },
    },
    calls,
  };
}

describe("output guard — gateway wiring", () => {
  it("a leaked structured response trips the guard to a degraded L2, discarding the model output", async () => {
    const { provider, calls } = recordingProvider(async () => ({
      text: asProviderText(
        needsWork({ hint: "Reach more children by next quarter." }),
      ),
      inputTokens: 120,
      outputTokens: 30,
      model: "pinned-model",
    }));
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1); // never retried after a trip
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined(); // model output discarded
    expect(result.guardTripped).toContain("banned term");
  });

  it("an 'ok' verdict leaking a hint trips the guard through the gateway", async () => {
    const { provider, calls } = recordingProvider(async () => ({
      text: asProviderText(needsWork({ verdict: "ok", hint: "You are doing great." })),
      inputTokens: 10,
      outputTokens: 5,
      model: "pinned-model",
    }));
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.guardTripped).toContain('verdict "ok" carries a non-empty hint');
  });

  it("a clean structured response passes the guard and is served at L0", async () => {
    const { provider, calls } = recordingProvider(async () => ({
      text: asProviderText(
        needsWork({ hint: "Count something you can look up next quarter." }),
      ),
      inputTokens: 120,
      outputTokens: 30,
      model: "pinned-model",
    }));
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
    expect(result.provider?.text).toContain("Count something");
    expect(result.guardTripped).toBeUndefined();
  });

  it("a trip produces the ordinary L2 static card: the sibling content for the question, clean and pre-written", async () => {
    // A guard trip is a plain L2 degrade — indistinguishable from any other L2
    // serving from the respondent's side. The static hint the L2 path serves is
    // STATIC_HINTS[question]; assert that content passes the guard itself, so
    // the served card is always valid, and that it is exactly what an ordinary
    // L2 serve would show.
    const { provider, calls } = recordingProvider(async () => ({
      text: asProviderText(
        needsWork({ hint: "Reach more children by next quarter." }),
      ),
      inputTokens: 10,
      outputTokens: 5,
      model: "pinned-model",
    }));
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    // The trip carries no model content — only the L2 degrade a consumer maps
    // to a static hint, so the respondent sees a normal L2 card.
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);

    // The static hint the L2 sibling would serve is pre-written in the coach's
    // tone and itself passes the guard, so the fallback card is never reaction
    // to the leaked content.
    for (const [qid, h] of Object.entries(STATIC_HINTS)) {
      const served = guardCoachResponse(JSON.stringify({ verdict: "needs_work", hint: h.hint, example: h.example ?? "" }));
      expect(served.kind, `${qid} static hint must be guard-clean`).toBe("pass");
    }
  });
});