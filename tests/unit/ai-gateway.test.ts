import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callProvider,
  gatewayCallRecord,
  ProviderHttpError,
  selectLevel,
  type AIProvider,
  type GatewayRecord,
  type GatewayResult,
  type ProviderRequest,
  type ProviderResponse,
} from "../../lib/ai-gateway";
import type { ClientBase } from "pg";

// F12-T01 — the gateway module (tech_infrastructure.md §2).
//
// The gateway is the single chokepoint every provider call passes through, and
// it never propagates an exception. These tests exercise the ordered pipeline
// with a faked provider: level selection → budget check → circuit check →
// request → timeout → output guard → logging. The module under test imports a
// real provider boundary (lib/provider.ts), but no real network call is made
// here; a stub satisfies the `AIProvider` shape instead.
//
// Three acceptance criteria map onto three kinds of test:
//  1. "a lint rule or test forbids provider SDK imports outside the gateway"
//     — a scan of lib/, app/ and scripts/ proves the provider boundary (and any
//     @anthropic-ai/sdk import) is reached only from lib/ai-gateway.ts;
//  2. "every stage is exercised by unit tests with a faked provider" — the
//     behavioural groups below drive each stage and observe its effect;
//  3. "the gateway never throws to its callers" — a throwing, a hanging, a
//     rejecting and a malformed provider all resolve to a lower-level result.

const REQ: ProviderRequest = {
  prompt: "Review this answer.",
  model: "pinned-model",
  maxTokens: 200,
};

/** A healthy, unpinned coach request context. */
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

/** A deterministic faked provider that records every request it receives. */
function recordingProvider(
  respond: (req: ProviderRequest) => Promise<ProviderResponse>,
): { provider: AIProvider; calls: ProviderRequest[] } {
  const calls: ProviderRequest[] = [];
  return {
    provider: {
      async request(req) {
        calls.push(req);
        return respond(req);
      },
    },
    calls,
  };
}

function okResponse(text = "Count something you can look up next quarter."): ProviderResponse {
  return {
    text,
    inputTokens: 120,
    outputTokens: 30,
    model: "pinned-model",
  };
}

/** Capture the structured log lines the gateway emits while a call runs. */
async function withLog<T>(fn: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi
    .spyOn(console, "log")
    .mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("level selection precedence (tech_infrastructure.md §6.1)", () => {
  it("a pinned level overrides every automatic condition", () => {
    expect(
      selectLevel({ pin: "L0", budgetExhausted: true, circuitOpen: true, latencyDegraded: true }),
    ).toBe("L0");
    expect(
      selectLevel({ pin: "L1", budgetExhausted: true, circuitOpen: true, latencyDegraded: false }),
    ).toBe("L1");
    expect(
      selectLevel({ pin: "L2", budgetExhausted: false, circuitOpen: false, latencyDegraded: true }),
    ).toBe("L2");
  });

  it("budget exhaustion wins over circuit and latency", () => {
    expect(
      selectLevel({ pin: "auto", budgetExhausted: true, circuitOpen: false, latencyDegraded: true }),
    ).toBe("L2");
  });

  it("an open circuit wins over latency", () => {
    expect(
      selectLevel({ pin: "auto", budgetExhausted: false, circuitOpen: true, latencyDegraded: true }),
    ).toBe("L2");
  });

  it("latency degrades to L1; a healthy call is L0", () => {
    expect(
      selectLevel({ pin: "auto", budgetExhausted: false, circuitOpen: false, latencyDegraded: true }),
    ).toBe("L1");
    expect(
      selectLevel({ pin: "auto", budgetExhausted: false, circuitOpen: false, latencyDegraded: false }),
    ).toBe("L0");
  });
});

describe("the pipeline serves the level that actually fits", () => {
  it("a healthy unpinned coach call reaches L0 and calls the provider once", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
    expect(result.provider?.text).toBe("Count something you can look up next quarter.");
  });

  it("a pinned L2 stops before the request — the provider is never called", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx({ pin: "L2" }), provider, REQ);
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
  });

  it("a pinned L1 stops before the request (deterministic-validators-only)", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx({ pin: "L1" }), provider, REQ);
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L1");
    expect(result.degraded).toBe(true);
  });

  it("latency degradation serves L1 without calling the provider", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx({ latencyDegraded: true }), provider, REQ);
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L1");
    expect(result.degraded).toBe(true);
  });

  it("an exhausted budget serves L2 without calling the provider", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx({ budgetExhausted: true }), provider, REQ);
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("an open circuit serves L2 without calling the provider", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(coachCtx({ circuitOpen: true }), provider, REQ);
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("a budget exhaustion that arrives after level selection still forces L2", async () => {
    // Pinned L0 by itself selects L0, but the budget gate that follows catches
    // an already-exhausted budget and forces L2 (F12-T04's permanent pin).
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(
      coachCtx({ pin: "L0", budgetExhausted: true }),
      provider,
      REQ,
    );
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("an open circuit that arrives after level selection still forces L2", async () => {
    const { provider, calls } = recordingProvider(async () => okResponse());
    const result = await callProvider(
      coachCtx({ pin: "L0", circuitOpen: true }),
      provider,
      REQ,
    );
    expect(calls).toHaveLength(0);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });
});

describe("request and timeout stages", () => {
  it("a hanging provider response is bounded by the timeout and falls to L2", async () => {
    const hanging = {
      provider: {
        request: () => new Promise<ProviderResponse>(() => {}),
      },
      calls: [] as never[],
    } as unknown as { provider: AIProvider; calls: ProviderRequest[] };
    const result = await callProvider(coachCtx({ timeoutMs: 20 }), hanging.provider, REQ);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
  });

  it("a rejecting provider falls to L2 and never throws", async () => {
    const { provider, calls } = recordingProvider(async () => {
      throw new Error("provider 503");
    });
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
  });
});

describe("timeout and retry policy (F12-T05, tech_infrastructure.md §6.2)", () => {
  // §6.2: "Timeout 6s, one retry only on 429/503 with jittered backoff. Never
  // retry a timeout." The timeout bound is injected small so the tests are
  // fast; the provider hangs/resolves against that bound, never against the
  // real 6s, and the retry backoff is injected to 0 so no test sleeps.

  function ctx(
    overrides: Partial<Parameters<typeof callProvider>[0]> = {},
  ): Parameters<typeof callProvider>[0] {
    return coachCtx({ retryBackoffMs: 0, ...overrides });
  }

  it("a provider that outlives the 6s bound yields a deterministic hint (L2), not an error", async () => {
    // §10 criterion 7: the coach produces a hint within 6s or the system
    // silently drops to L2. A response that would take longer than the bound
    // is served as the deterministic sibling; the slow write is the provider's
    // business, not the respondent's.
    const { provider, calls } = recordingProvider(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(okResponse()), 50);
        }),
    );
    const result = await callProvider(ctx({ timeoutMs: 20 }), provider, REQ);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
    // A bounded-out provider is never retried — the timeout reports *time*.
    expect(calls).toHaveLength(1);
  });

  it("a 429 is retried once and the retry's success is served", async () => {
    let attempt = 0;
    const { provider, calls } = recordingProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new ProviderHttpError(429);
      return okResponse();
    });
    const result = await callProvider(ctx(), provider, REQ);
    expect(calls).toHaveLength(2);
    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
    expect(result.provider?.text).toBe("Count something you can look up next quarter.");
  });

  it("a 503 is retried once and the retry's success is served", async () => {
    let attempt = 0;
    const { provider, calls } = recordingProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new ProviderHttpError(503);
      return okResponse();
    });
    const result = await callProvider(ctx(), provider, REQ);
    expect(calls).toHaveLength(2);
    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
  });

  it("retries exactly once: a persistent 429 makes two calls and falls to L2", async () => {
    const { provider, calls } = recordingProvider(async () => {
      throw new ProviderHttpError(429);
    });
    const result = await callProvider(ctx(), provider, REQ);
    expect(calls).toHaveLength(2);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
  });

  it("a retry that itself times out is served at L2, never retried again", async () => {
    const { provider, calls } = recordingProvider(async () => {
      throw new ProviderHttpError(429);
    });
    const result = await callProvider(ctx({ timeoutMs: 20 }), provider, REQ);
    // The first attempt errors immediately (429 → retry); the second hangs
    // until the bound fires. Two calls, one retry, an L2 fallback.
    expect(calls).toHaveLength(2);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("a timeout is never retried — the provider is called once", async () => {
    const { provider, calls } = recordingProvider(() => new Promise<ProviderResponse>(() => {}));
    const result = await callProvider(ctx({ timeoutMs: 20 }), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("a rejection that is not a 429/503 (generic error) is not retried", async () => {
    const { provider, calls } = recordingProvider(async () => {
      throw new Error("connection reset");
    });
    const result = await callProvider(ctx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("a non-retriable HTTP status (e.g. 500) is not retried", async () => {
    const { provider, calls } = recordingProvider(async () => {
      throw new ProviderHttpError(500);
    });
    const result = await callProvider(ctx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
  });

  it("the retry re-sends the same capped request, not a fresh one", async () => {
    let attempt = 0;
    const { provider, calls } = recordingProvider(async () => {
      attempt += 1;
      if (attempt === 1) throw new ProviderHttpError(503);
      return okResponse();
    });
    const req = { ...REQ, maxTokens: 5000 }; // over the coach cap → is capped
    await callProvider(ctx(), provider, req);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0].maxTokens).toBeLessThanOrEqual(200);
  });

  it("fuzzing the provider with failures never produces a 5xx outcome", async () => {
    // §6.2: "/api/coach never returns a 5xx to the browser; it returns a valid
    // coach response served at a lower level." The endpoint is F13 land, but
    // the guarantee it leans on is here: feed the gateway every failure the
    // provider can throw and it must keep resolving to a valid result — a
    // level the caller can serve deterministically, never a thrown 5xx.
    const failureModes: Array<() => Promise<ProviderResponse>> = [
      () => Promise.reject(new ProviderHttpError(429)),
      () => Promise.reject(new ProviderHttpError(503)),
      () => Promise.reject(new ProviderHttpError(500)),
      () => Promise.reject(new Error("network down")),
      () => Promise.reject("string rejection"),
      () => new Promise<ProviderResponse>(() => {}), // hangs → timeout
      () => Promise.resolve(okResponse("Count how many clinic visits happen.")), // guard trip
    ];

    for (let i = 0; i < failureModes.length; i += 1) {
      const mode = failureModes[i]!;
      const heavy = {
        provider: { request: () => mode() },
      } as unknown as AIProvider;
      const result = await callProvider(ctx({ timeoutMs: 15 }), heavy, REQ);
      // Every mode must resolve to a real, servable level — never a throw that
      // could surface as a 5xx on /api/coach.
      expect(["L0", "L1", "L2"]).toContain(result.level);
      expect(result.degraded).toBe(result.provider === undefined);
    }
  });
});

describe("output guard stage", () => {
  it("a clean coach response passes the guard and is served at L0", async () => {
    const { provider } = recordingProvider(async () => okResponse());
    const { value: result, lines } = await withLog(() =>
      callProvider(coachCtx(), provider, REQ),
    );
    expect(result.level).toBe("L0");
    expect(result.degraded).toBe(false);
    expect(result.provider).toBeDefined();
    expect(result.guardTripped).toBeUndefined();
    // The log line reports a clean guard.
    expect(lines.some((l) => JSON.parse(l).guardResult === "ok")).toBe(true);
  });

  it("a coach response with a banned term trips the guard and is served at L2", async () => {
    const { provider, calls } = recordingProvider(async () =>
      okResponse("You could count how many clinic visits happen."),
    );
    const result = await callProvider(coachCtx(), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.provider).toBeUndefined();
    expect(result.guardTripped).toContain("banned term");
  });

  it("the guard does not run for facilitator-only purposes", async () => {
    // Analysis output is not the respondent-facing coach, so its looser rules
    // apply (tech_infrastructure.md §5.5); the gateway leaves it to the guard.
    const { provider, calls } = recordingProvider(async () =>
      okResponse("Respondents disagree about whether to expand the clinic."),
    );
    const result = await callProvider(coachCtx({ purpose: "analysis" }), provider, REQ);
    expect(calls).toHaveLength(1);
    expect(result.level).toBe("L0");
    expect(result.provider).toBeDefined();
    expect(result.degraded).toBe(false);
    expect(result.guardTripped).toBeUndefined();
  });
});

describe("the gateway never throws to its callers", () => {
  it("returns a degraded result when the provider is malformed", async () => {
    const malformed = {} as unknown as AIProvider;
    const result = await callProvider(coachCtx(), malformed, REQ);
    expect(result.level).toBe("L2");
    expect(result.degraded).toBe(true);
    expect(result.guardTripped).toBe("gateway_failed");
  });

  it("resolves rather than rejects for throwing, hanging and rejecting providers", async () => {
    const throwing = {
      provider: { request: () => Promise.reject(new Error("boom")) },
    } as unknown as { provider: AIProvider };
    const hanging = {
      provider: { request: () => new Promise<ProviderResponse>(() => {}) },
    } as unknown as { provider: AIProvider };

    await expect(callProvider(coachCtx(), throwing.provider, REQ)).resolves.toMatchObject({
      level: "L2",
      degraded: true,
    });
    await expect(callProvider(coachCtx({ timeoutMs: 20 }), hanging.provider, REQ)).resolves.toMatchObject({
      level: "L2",
      degraded: true,
    });
  });
});

describe("logging stage emits exactly one structured record per call", () => {
  it("logs the served level and token counts for a served L0 call", async () => {
    const { provider } = recordingProvider(async () => okResponse());
    const { lines } = await withLog(() => callProvider(coachCtx(), provider, REQ));
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as {
      purpose: string;
      level: string;
      latencyMs: number;
      tokens: { input: number; output: number };
      guardResult: string;
    };
    expect(record.purpose).toBe("coach");
    expect(record.level).toBe("L0");
    expect(record.tokens).toEqual({ input: 120, output: 30 });
    expect(record.guardResult).toBe("ok");
  });

  it("logs zero tokens and the tripped guard for a degraded L2 call", async () => {
    const { provider } = recordingProvider(async () =>
      okResponse("Count how many clinic visits happen."),
    );
    const { lines } = await withLog(() => callProvider(coachCtx(), provider, REQ));
    expect(lines).toHaveLength(1);
    const record = JSON.parse(lines[0]) as {
      level: string;
      tokens: { input: number; output: number };
      guardResult: string;
    };
    expect(record.level).toBe("L2");
    expect(record.tokens).toEqual({ input: 0, output: 0 });
    expect(record.guardResult).toContain("banned term");
  });

  it("structured log lines for a call never contain the answer text it rode in on", async () => {
    // §11: "application logs never contain answer text". The gateway only
    // logs purpose/level/latency/tokens/guard — the prompt (which holds the
    // answer) travels to the provider, never into a log line. Assert this
    // directly against a call whose request carries a distinctive marker.
    const marker = "PLUMBINGALIGN79 NEARESTWAREHOUSE";
    const { provider } = recordingProvider(async () => okResponse());
    const { lines } = await withLog(() =>
      callProvider(coachCtx(), provider, { ...REQ, prompt: `The answer was ${marker}.` }),
    );
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).not.toContain(marker);
    expect(Object.keys(parsed).sort()).toEqual(["guardResult", "latencyMs", "level", "purpose", "tokens"]);
  });
});

describe("interaction-row capture (F12-T06, tech_infrastructure.md §3)", () => {
  // The gateway maps each served call onto the ai_interactions row through the
  // pure gatewayCallRecord function; recordModelCall persists it in one
  // transaction with the token counters. These tests prove the mapping — the
  // two audit acceptances that hold without (and even survive) a database:
  //  1. a served L0 call records non-zero token counts and the model used;
  //  2. a degraded (L1/L2) call records zero tokens at the level that served it.

  function record(overrides: Partial<GatewayRecord> = {}): GatewayRecord {
    return {
      db: {} as unknown as ClientBase,
      cohortId: "cohort-1",
      respondentId: "resp-1",
      questionId: "q7",
      attemptNo: 2,
      verdict: "needs_work",
      hintText: "Make it countable.",
      exampleShown: true,
      ...overrides,
    };
  }

  it("returns null for a call with no audit wiring", () => {
    const result: GatewayResult = { level: "L0", degraded: false, provider: okResponse() };
    expect(gatewayCallRecord({ purpose: "coach", record: undefined }, REQ, result)).toBeNull();
  });

  it("a served L0 call records non-zero tokens and the model that produced it", () => {
    const result: GatewayResult = {
      level: "L0",
      degraded: false,
      provider: { ...okResponse(), model: "claude-sonnet-5" },
    };
    const row = gatewayCallRecord({ purpose: "coach", record: record() }, REQ, result);
    expect(row).not.toBeNull();
    expect(row!.cohortId).toBe("cohort-1");
    expect(row!.respondentId).toBe("resp-1");
    expect(row!.questionId).toBe("q7");
    expect(row!.purpose).toBe("coach");
    expect(row!.attemptNo).toBe(2);
    expect(row!.level).toBe("L0");
    expect(row!.model).toBe("claude-sonnet-5");
    expect(row!.inputTokens).toBe(120);
    expect(row!.outputTokens).toBe(30);
    expect(row!.guardTripped).toBeNull();
    expect(row!.answerChanged).toBe(false);
  });

  it("a degraded L2 call records zero tokens but the level stored for the audit", () => {
    const result: GatewayResult = { level: "L2", degraded: true };
    const row = gatewayCallRecord({ purpose: "coach", record: record() }, REQ, result);
    expect(row!.level).toBe("L2");
    expect(row!.inputTokens).toBe(0);
    expect(row!.outputTokens).toBe(0);
    // The pinned model the call was aimed at is still recorded, so a mid-cohort
    // model change is visible even when the model never ran (FR-35).
    expect(row!.model).toBe(REQ.model);
  });

  it("records a tripped guard and, for analysis, no guard", () => {
    const tripped: GatewayResult = { level: "L2", degraded: true, guardTripped: "banned term: clinic" };
    const t = gatewayCallRecord({ purpose: "coach", record: record() }, REQ, tripped);
    expect(t!.guardTripped).toBe("banned term: clinic");

    const analysis: GatewayResult = { level: "L0", degraded: false, provider: okResponse() };
    const a = gatewayCallRecord({ purpose: "analysis", record: record() }, REQ, analysis);
    expect(a!.guardTripped).toBeNull();
  });
});

describe("no provider SDK import outside the gateway (F12-T01)", () => {
  const ROOT = resolve(process.cwd());
  const ALLOWED = new Set(["lib/ai-gateway.ts", "lib/provider.ts"]);

  function sourceFiles(files: string[], dir: string): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(files, full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
    return files;
  }

  // Targets the import specifier itself, so a const named "anthropicProvider"
  // or a mention of the ANTHROPIC_API_KEY env var is not a false positive.
  const SDK_IMPORT = /from\s+["'][^"']*(?:provider|anthropic)[^"']*["']/;

  it("reaches lib/provider.ts (or an SDK) only from lib/ai-gateway.ts", () => {
    const offenders: string[] = [];
    for (const dir of ["lib", "app", "scripts"]) {
      for (const file of sourceFiles([], resolve(ROOT, dir))) {
        const rel = relative(ROOT, file);
        if (ALLOWED.has(rel)) continue;
        const source = readFileSync(file, "utf8");
        if (SDK_IMPORT.test(source)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forbids importing the gateway into any 'use client' file", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles([], resolve(ROOT, "app"))) {
      const source = readFileSync(file, "utf8");
      const isClient =
        /\buse client\b/.test(source) || /"use client";/.test(source);
      if (isClient && /from\s+["'][^"']*ai-gateway["']/.test(source)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});