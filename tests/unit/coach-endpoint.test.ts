import { join } from "node:path";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCoachProviderRequest,
  coachResponseFromResult,
  degradedCoachBody,
  serveCoach,
} from "../../lib/coach-endpoint";
import { COACH_SYSTEM_PROMPT, type CoachRequestContext } from "../../lib/coach-prompt";
import { STATIC_HINTS } from "../../lib/static-hints";
import type { AIProvider, GatewayContext, GatewayResult, ProviderResponse } from "../../lib/ai-gateway";
import { ProviderHttpError } from "../../lib/ai-gateway";
import { POST } from "../../app/api/coach/route";

// F13-T04 — coach endpoint resilience (tech_infrastructure.md §6.2, spec.md §10
// criterion 7, PR3, PR6). The acceptance edits here are the ones that matter:
//
//   1. fuzzing the provider with every error class yields no 5xx from /api/coach;
//   2. a provider that outlives the 6s budget yields a deterministic hint within
//      the pending-state budget;
//   3. no respondent-facing string anywhere references AI availability.
//
// The provider path is exercised through `serveCoach` with a stubbed provider
// (exactly as the gateway tests do), so no network or model is needed. The
// route itself is exercised directly for the "no 5xx under any condition"
// surface with a broken environment.

function coachCtx(overrides: Partial<CoachRequestContext> = {}): CoachRequestContext {
  return {
    questionId: "q7",
    questionText: "What single outcome is this promise really about?",
    helper: "One clear outcome.",
    answer: "We will grow the subscriber base.",
    exampleRequested: false,
    ...overrides,
  };
}

function gatewayCtx(overrides: Partial<GatewayContext> = {}): GatewayContext {
  return {
    purpose: "coach",
    pin: "auto",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
    retryBackoffMs: 0,
    timeoutMs: 20,
    ...overrides,
  };
}

describe("coachResponseFromResult — shapes the served level and hint", () => {
  it("serves a clean L0 response with the level reported for logging", () => {
    const result: GatewayResult = {
      level: "L0",
      degraded: false,
      provider: {
        text: JSON.stringify({
          verdict: "needs_work",
          dimension: "measurability",
          hint: "Count something you can look up next quarter.",
          example: "A courier counts deliveries per day.",
        }),
        inputTokens: 10,
        outputTokens: 5,
        model: "pinned-model",
      },
    };
    const body = coachResponseFromResult(coachCtx({ exampleRequested: true }), result);
    expect(body.level).toBe("L0");
    expect(body.verdict).toBe("needs_work");
    expect(body.hint).toBe("Count something you can look up next quarter.");
    expect(body.example).toBe("A courier counts deliveries per day.");
  });

  it("an ok verdict carries an empty hint even at L0", () => {
    const result: GatewayResult = {
      level: "L0",
      degraded: false,
      provider: {
        text: JSON.stringify({ verdict: "ok", dimension: null, hint: "", example: "" }),
        inputTokens: 10,
        outputTokens: 5,
        model: "pinned-model",
      },
    };
    const body = coachResponseFromResult(coachCtx(), result);
    expect(body.verdict).toBe("ok");
    expect(body.hint).toBe("");
    expect(body.level).toBe("L0");
  });

  it("a degraded L2 result returns the deterministic static hint at L2", () => {
    const body = coachResponseFromResult(coachCtx(), { level: "L2", degraded: true });
    expect(body.verdict).toBe("needs_work");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
    expect(body.level).toBe("L2");
  });

  it("a degraded L1 result returns the static hint served at L1", () => {
    const body = coachResponseFromResult(coachCtx(), { level: "L1", degraded: true });
    expect(body.level).toBe("L1");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
  });

  it("an L0 reply that does not parse as §5.3 output degrades to the static hint", () => {
    // A guard-clean but non-structured reply (plain text) is not servable as a
    // shaped coach response; it must degrade rather than reach the browser.
    const result: GatewayResult = {
      level: "L0",
      degraded: false,
      provider: { text: "Count something you can look up.", inputTokens: 1, outputTokens: 1, model: "m" },
    };
    const body = coachResponseFromResult(coachCtx(), result);
    expect(body.level).toBe("L2");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
  });
});

describe("serveCoach — provider fuzzing yields no 5xx (acceptance 1)", () => {
  // Spec §6.2 is explicit: "/api/coach never returns a 5xx to the browser; it
  // returns a valid coach response served at a lower level." `serveCoach` is
  // the code path that converts a provider outcome into that response, so
  // feeding it every error class the provider can throw must always resolve to
  // a valid L2 body — the thing the route turns into a 200 — never a throw.
  const failureModes: Array<() => Promise<ProviderResponse>> = [
    () => Promise.reject(new ProviderHttpError(429)),
    () => Promise.reject(new ProviderHttpError(503)),
    () => Promise.reject(new ProviderHttpError(500)),
    () => Promise.reject(new Error("network down")),
    () => Promise.reject("string rejection"),
    () => new Promise<ProviderResponse>(() => {}), // hangs → timeout → L2
  ];

  it.each(failureModes)("every error class resolves to a valid L2 body, never a throw", async (mode) => {
    const provider: AIProvider = { request: () => mode() };
    const body = await serveCoach(coachCtx(), gatewayCtx(), provider, "pinned-model");
    expect(body.level).toBe("L2");
    expect(body.verdict).toBe("needs_work");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
  });
});

describe("serveCoach — forced latency yields a hint within the pending-state budget (acceptance 2)", () => {
  it("a provider that outlives the timeout returns the deterministic hint quickly", async () => {
    const slow = {
      request: async (): Promise<ProviderResponse> => {
        // Far beyond the §6.2 6s budget; the injected 20ms timeout stands in for
        // the real 6s so the test runs in milliseconds while proving the same
        // behaviour: a slow model serves the deterministic hint, not a spinner.
        await new Promise((r) => setTimeout(r, 500));
        return JSON.parse("{}") as ProviderResponse;
      },
    };
    const started = Date.now();
    const body = await serveCoach(coachCtx(), gatewayCtx({ timeoutMs: 20 }), slow, "pinned-model");
    const elapsed = Date.now() - started;

    expect(body.level).toBe("L2");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
    // Well under the 6s pending-state budget (ui_ux.md §5.1) even though the
    // provider would have taken 500ms to answer at all.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("F13-T05 — examples on request only (FR-18, FR-19, spec.md §6.2, ui_ux §5.2)", () => {
  // The endpoint is the gate that makes FR-18 real on the model path: an
  // example may be served only when the respondent asked for one, and when a
  // requested example is generated it comes from a neutral domain framed as a
  // shape — otherwise the static one is served instead (acceptance criteria).

  function l0WithExample(example: string): GatewayResult {
    return {
      level: "L0",
      degraded: false,
      provider: {
        text: JSON.stringify({
          verdict: "needs_work",
          dimension: "measurability",
          hint: "Count something you can look up next quarter.",
          example,
        }),
        inputTokens: 5,
        outputTokens: 5,
        model: "pinned-model",
      },
    };
  }

  it("no example is served unless the respondent asked for one (acceptance 1)", () => {
    // A clean L0 model reply that smuggles an example out without a request is
    // a prompt leak. The serve boundary drops it regardless of the guard, so
    // the audit log — which flips example_shown only from a request — and the
    // served body agree that no example was generated.
    const body = coachResponseFromResult(coachCtx(), l0WithExample("A courier counts deliveries per day."));
    expect(body.level).toBe("L0");
    expect(body.example).toBe("");

    // The same clean output, asked for, is served.
    const asked = coachResponseFromResult(
      coachCtx({ exampleRequested: true }),
      l0WithExample("A courier counts deliveries per day."),
    );
    expect(asked.example).toBe("A courier counts deliveries per day.");
  });

  it("an unrequested example stays empty on a degraded serve too", () => {
    const body = coachResponseFromResult(coachCtx(), { level: "L2", degraded: true });
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
    expect(body.example).toBe("");
  });

  it("a requested but degraded serve draws the example from the static set", () => {
    const body = coachResponseFromResult(
      coachCtx({ exampleRequested: true }),
      { level: "L2", degraded: true },
    );
    expect(body.example).toBe(STATIC_HINTS.q7.example);
  });

  it("a prohibited-domain example trips the guard and is replaced by the static one (acceptance 3)", async () => {
    // The provider leaks a "patient/clinic" example. The guard rejects the
    // whole reply, the gateway degrades to L2, and the requested example is
    // served from the static set — so a leaking model never reaches the browser
    // and the respondent still gets a framed, neutral example.
    const leaking: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: JSON.stringify({
          verdict: "needs_work",
          dimension: "measurability",
          hint: "Count something you can look up next quarter.",
          example: "A children's clinic counts new patients each month.",
        }),
        inputTokens: 5,
        outputTokens: 5,
        model: "pinned-model",
      }),
    };
    const body = await serveCoach(
      coachCtx({ exampleRequested: true }),
      gatewayCtx(),
      leaking,
      "pinned-model",
    );
    expect(body.level).toBe("L2");
    expect(body.hint).toBe(STATIC_HINTS.q7.hint);
    expect(body.example).toBe(STATIC_HINTS.q7.example);
  });

  it("the deterministic served example carries the §5.2 shape-framing closing (acceptance 2)", () => {
    const examples = Object.values(STATIC_HINTS)
      .map((h) => h.example)
      .filter((e): e is string => e !== undefined);
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example, example).toMatch(/Yours will be about your business, not \w+\b/i);
    }
  });

  it("at most one example is ever served per request (requirement 4)", () => {
    // The §5.3 output schema has a single string `example` field, so a reply
    // can hold at most one example; the served body passes that one field
    // through unchanged (or drops it to empty on the request gate).
    const asked = coachResponseFromResult(
      coachCtx({ exampleRequested: true }),
      l0WithExample("A bakery sells a full pallet of flour in a week."),
    );
    expect(typeof asked.example).toBe("string");
    expect(asked.example).toBe("A bakery sells a full pallet of flour in a week.");
  });
});

describe("buildCoachProviderRequest — the outbound payload stays minimal", () => {
  it("uses structured output (forced tool), the §5.2 system prompt and the coach cap", () => {
    const req = buildCoachProviderRequest(coachCtx(), "pinned-model");
    expect(req.model).toBe("pinned-model");
    expect(req.maxTokens).toBe(200);
    expect(req.structuredOutput).toBeDefined();
    expect(req.structuredOutput!.system).toBe(COACH_SYSTEM_PROMPT);
    expect(req.structuredOutput!.tool.name).toBe("coach_result");
  });

  it("carries only the one answer and question metadata — no identity", () => {
    const req = buildCoachProviderRequest(coachCtx(), "pinned-model");
    const message = req.structuredOutput!.userMessage;
    expect(message).toContain(coachCtx().answer);
    expect(message).toContain(coachCtx().questionText);
    // No name, id, email, or respondent identity can reach the model.
    expect(message).not.toMatch(/respondent|cohort|@|\bid\b|name/i);
  });

  it("adds the example request line only when example_requested is true", () => {
    const asked = buildCoachProviderRequest(coachCtx({ exampleRequested: true }), "m");
    expect(asked.structuredOutput!.userMessage).toMatch(/asked for ONE shape-of-an-answer example/);
    const notAsked = buildCoachProviderRequest(coachCtx({ exampleRequested: false }), "m");
    expect(notAsked.structuredOutput!.userMessage).not.toMatch(/asked for ONE/);
  });
});

describe("degradedCoachBody — the outermost non-5xx edge", () => {
  it("attaches the static hint and static example for a known question", () => {
    const body = degradedCoachBody("q7");
    expect(body).toEqual({
      verdict: "needs_work",
      dimension: null,
      hint: STATIC_HINTS.q7.hint,
      example: STATIC_HINTS.q7.example,
      level: "L2",
    });
  });

  it("still returns a valid body, with empty hint and example, when the question is unknown", () => {
    const body = degradedCoachBody(null);
    expect(body.level).toBe("L2");
    expect(body.hint).toBe("");
    expect(body.example).toBe("");
    expect(body.verdict).toBe("needs_work");
  });
});

describe("POST /api/coach — never a 5xx at the route surface", () => {
  function post(body: unknown): Promise<Response> {
    return POST(
      new Request("http://localhost/api/coach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  it("rejects a malformed body with 400, not 5xx", async () => {
    const res = await post("not json");
    expect(res.status).toBe(400);
  });

  it("rejects an unknown question id with 400, not 5xx", async () => {
    const res = await post({ question_id: "q99" });
    expect(res.status).toBe(400);
  });

  it("a valid request with no database still serves a degraded coach body, never 5xx", async () => {
    const savedUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const res = await post({ question_id: "q7" });
      // The database is the one thing the healthy path needs; with it gone the
      // route must still come back with a valid coach card, not a 500.
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(500);
      const json = (await res.json()) as { level: string; hint: string };
      expect(json.level).toBe("L2");
      expect(json.hint).toBe(STATIC_HINTS.q7.hint);
    } finally {
      if (savedUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedUrl;
    }
  });
});

describe("no respondent-facing string references AI availability (acceptance 3)", () => {
  // PR6: the respondent can never tell the AI dropped a level. The only copy
  // that must reference AI lives behind the facilitator gate (app/admin), which
  // is deliberately excluded. This scans every other respondent-facing tsx
  // file for strings that would reveal that something "AI" is unavailable.
  const REVEAL =
    /\bAI\b|artificial intelligence|Anthropic|unavailable|down for maintenance|spinner/i;
  const ROOT = resolve(process.cwd());

  function respondentFacingFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "admin") continue; // facilitator-only
          walk(full);
        } else if (entry.name.endsWith(".tsx")) {
          files.push(full);
        }
      }
    };
    walk(join(ROOT, "app"));
    return files;
  }

  function extractCopy(source: string): string[] {
    const out: string[] = [];
    for (const m of source.matchAll(/["'`]([^"'`\n]+)["'`]/g)) out.push(m[1]!);
    // JSX text nodes: anything between a tag's close and the next open, with no
    // nested tag or brace (so code blocks and expressions are skipped).
    for (const m of source.matchAll(/>([^<>{}]+)</g)) out.push(m[1]!);
    return out;
  }

  it("no respondent-facing string mentions an AI being unavailable", () => {
    const offending: Array<[string, string]> = [];
    for (const file of respondentFacingFiles()) {
      const source = readFileSync(file, "utf8");
      for (const copy of extractCopy(source)) {
        if (REVEAL.test(copy)) offending.push([file, copy.trim()]);
      }
    }
    expect(offending).toEqual([]);
  });

  it("the scan is not vacuous — it actually reads respondent-facing files", async () => {
    expect(existsSync(ROOT)).toBe(true);
    expect(respondentFacingFiles().length).toBeGreaterThan(5);
  });
});