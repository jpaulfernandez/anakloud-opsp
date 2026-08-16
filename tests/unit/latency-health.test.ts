import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LATENCY_HEALTH_THRESHOLD_MS,
  isLatencyDegraded,
  p95Latency,
} from "../../lib/latency-health";
import {
  callProvider,
  isCurrentLatencyDegraded,
  providerLatencySampleCount,
  resetLatencyHealth,
  selectLevel,
  type AIProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../../lib/ai-gateway";

// F12-T02 — level selection, tech_infrastructure.md §6.1. The precedence order
// (pin → budget → circuit → p95 latency → L0) lives in `selectLevel` (built with
// F12-T01) and its precedence tests live in ai-gateway.test.ts. This ticket's
// own contribution is rule 4 — the p95-latency-over-last-20-calls signal that
// `selectLevel` consumes. These tests exercise that computation in isolation
// (a pure function over latencies), in its ready-made form suitable for the
// exchange rule 4, and prove the gateway actually feeds it from the calls it
// has made.

const REQ: ProviderRequest = {
  prompt: "Review this answer.",
  model: "pinned-model",
  maxTokens: 200,
};

/** A provider that answers after a configurable delay. */
function delayedProvider(delayMs: number): AIProvider {
  return {
    async request() {
      await new Promise((r) => setTimeout(r, delayMs));
      return { text: "Count something you can look up.", inputTokens: 10, outputTokens: 5, model: "pinned-model" } satisfies ProviderResponse;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetLatencyHealth();
});

describe("p95Latency (nearest-rank)", () => {
  it("reports 0 for an empty set (never degraded on no data)", () => {
    expect(p95Latency([])).toBe(0);
    expect(isLatencyDegraded([])).toBe(false);
  });

  it("a single latency is its own p95", () => {
    expect(p95Latency([4200])).toBe(4200);
  });

  it("returns the nearest-rank p95 of a small set", () => {
    // 100, 200, 300 -> rank = ceil(3 * 0.95) = 3 -> the largest.
    expect(p95Latency([100, 300, 200])).toBe(300);
  });

  it("is order-independent and picks the boundary value in a full window", () => {
    // A window of 20 distinct latencies: the 95th percentile is the value that
    // 95% of samples are <= it, i.e. the 19th smallest of 20.
    const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    const sortedDesc = [...latencies].sort((a, b) => b - a);
    expect(p95Latency(sortedDesc)).toBe(1900);
  });
});

describe("isLatencyDegraded (rule 4) keying on > 6s p95", () => {
  it("is false for a uniformly fast set", () => {
    expect(isLatencyDegraded(Array.from({ length: 20 }, () => 800))).toBe(false);
  });

  it("is true when the p95 crosses the 6s threshold", () => {
    // Two 9s stalls in a 20-sample window (≥10%) raise the p95 past 6s; a
    // single stall is only the top 5% and stays below the 95th percentile.
    expect(isLatencyDegraded([...Array.from({ length: 18 }, () => 800), 9000, 9000])).toBe(true);
  });

  it("is false at exactly the threshold (must *exceed* 6 seconds)", () => {
    const atThreshold = Array.from({ length: 20 }, () => LATENCY_HEALTH_THRESHOLD_MS);
    expect(isLatencyDegraded(atThreshold)).toBe(false);
  });

  it("considers only the last LATENCY_WINDOW calls", () => {
    // 100 fast calls, then 20 slow ones: the window is the recent 20.
    const series = [
      ...Array.from({ length: 100 }, () => 500),
      ...Array.from({ length: 20 }, () => 9000),
    ];
    expect(isLatencyDegraded(series)).toBe(true);
    // The reverse — slow long ago, fast now — is healthy again.
    const recovered = [
      ...Array.from({ length: 20 }, () => 9000),
      ...Array.from({ length: 100 }, () => 500),
    ];
    expect(isLatencyDegraded(recovered)).toBe(false);
  });

  it("degrades on a small window too: few calls where the p95 is slow", () => {
    // With 5 samples, nearest-rank p95 is the max.
    expect(isLatencyDegraded([500, 500, 500, 500, 7000])).toBe(true);
  });
});

describe("rule 4 feeds selectLevel (tech_infrastructure.md §6.1 precedence)", () => {
  const auto = { pin: "auto" as const, budgetExhausted: false, circuitOpen: false };

  it("a degraded p95 yields L1; a healthy p95 yields L0", () => {
    // Two slow calls at the tail raise the p95 of the last-20 window past 6s.
    const slowCalls = [...Array.from({ length: 20 }, () => 500), 9000, 9000];
    const fastCalls = Array.from({ length: 20 }, () => 500);
    expect(
      selectLevel({ ...auto, latencyDegraded: isLatencyDegraded(slowCalls) }),
    ).toBe("L1");
    expect(
      selectLevel({ ...auto, latencyDegraded: isLatencyDegraded(fastCalls) }),
    ).toBe("L0");
  });

  it("latency loses to budget, circuit and an explicit pin", () => {
    // The precedence tests in ai-gateway.test.ts cover this; here we bind the
    // rule-4 result to the order so the connection is visible.
    const degraded = isLatencyDegraded([...Array.from({ length: 20 }, () => 500), 9000, 9000]);
    expect(degraded).toBe(true);
    expect(selectLevel({ ...auto, latencyDegraded: degraded })).toBe("L1");
    expect(selectLevel({ ...auto, latencyDegraded: degraded, budgetExhausted: true })).toBe("L2");
    expect(selectLevel({ ...auto, latencyDegraded: degraded, circuitOpen: true })).toBe("L2");
    expect(selectLevel({ ...auto, latencyDegraded: degraded, pin: "L0" })).toBe("L0");
  });
});

describe("the gateway feeds the latency window from calls it has made", () => {
  it("starts empty and stays empty when no provider call runs", async () => {
    expect(providerLatencySampleCount()).toBe(0);
    // A pinned L2 request stops before the request stage — it never contacts
    // the provider, so it is not a latency sample.
    const provider = delayedProvider(2);
    await callProvider(
      { purpose: "coach", pin: "L2", budgetExhausted: false, circuitOpen: false, latencyDegraded: false },
      provider,
      REQ,
    );
    expect(providerLatencySampleCount()).toBe(0);
    expect(isCurrentLatencyDegraded()).toBe(false);
  });

  it("records a sample for a call that reached the provider", async () => {
    await callProvider(
      { purpose: "coach", pin: "auto", budgetExhausted: false, circuitOpen: false, latencyDegraded: false },
      delayedProvider(2),
      REQ,
    );
    expect(providerLatencySampleCount()).toBe(1);
    // Its latency is healthy, so the live flag follows.
    expect(isCurrentLatencyDegraded()).toBe(false);
  });

  it("records a timed-out provider call as a latency sample too", async () => {
    const hanging = {
      provider: { request: () => new Promise<ProviderResponse>(() => {}) },
    } as unknown as { provider: AIProvider };
    await callProvider(
      { purpose: "coach", pin: "auto", budgetExhausted: false, circuitOpen: false, latencyDegraded: false, timeoutMs: 15 },
      hanging.provider,
      REQ,
    );
    // A timeout still contacted the provider, so it counts toward the p95.
    expect(providerLatencySampleCount()).toBe(1);
    expect(isCurrentLatencyDegraded()).toBe(false);
  });
});