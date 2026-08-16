import { describe, expect, it } from "vitest";

import {
  CIRCUIT_OPEN_BASE_MS,
  CIRCUIT_OPEN_MAX_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  circuitOpenAt,
  closedCircuit,
  probeAllowed,
  recordFailure,
  recordSuccess,
} from "../../lib/circuit";
import { selectLevel } from "../../lib/ai-gateway";

// F12-T03 — the circuit breaker (spec.md §7.2, tech_infrastructure.md §6.1).
// The three acceptances — "three induced failures open the circuit", "backoff
// doubles and caps at 30 minutes", and the probe lifecycle — are all behaviours
// of the pure state machine, so they are exercised here without a database.
// Durable persistence across a restart is covered in circuit.integration.test.
//
// Interlocking with the gateway: the circuit's `circuitOpenAt` produces the
// boolean that fills `GatewayContext.circuitOpen`, and `selectLevel` then
// serves L2 — demonstrating "open the circuit ... and serve L2" against the
// real precedence logic rather than a reimplementation of it.

const NOW = 1_700_000_000_000;

describe("the circuit opens after three consecutive provider failures", () => {
  it("stays closed below the threshold and opens on the third consecutive failure", () => {
    let state = closedCircuit();
    for (let i = 1; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      state = recordFailure(state, NOW + i);
      expect(state.open).toBe(false);
      expect(state.consecutiveFailures).toBe(i);
    }
    state = recordFailure(state, NOW + CIRCUIT_FAILURE_THRESHOLD);
    expect(state.open).toBe(true);
    expect(state.reason).toBe("three consecutive provider failures");
    expect(state.untilMs).toBe(
      NOW + CIRCUIT_FAILURE_THRESHOLD + CIRCUIT_OPEN_BASE_MS,
    );
  });

  it("a success resets the count so only *consecutive* failures open it", () => {
    let state = closedCircuit();
    state = recordFailure(state, NOW + 1);
    state = recordFailure(state, NOW + 2);
    state = recordSuccess(state); // a healthy call breaks the run
    expect(state.consecutiveFailures).toBe(0);
    // Two more failures is not three consecutive — the circuit stays closed.
    state = recordFailure(state, NOW + 3);
    state = recordFailure(state, NOW + 4);
    expect(state.open).toBe(false);
    expect(state.consecutiveFailures).toBe(2);
  });
});

describe("an open circuit serves L2 and stops blocking once the interval elapses", () => {
  function opened(): ReturnType<typeof recordFailure> {
    let s = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) s = recordFailure(s, NOW + i);
    return s;
  }

  it("refuses model calls (context flag true) and selects L2 until the interval elapses", () => {
    const state = opened();
    expect(circuitOpenAt(state, NOW + CIRCUIT_FAILURE_THRESHOLD)).toBe(true);
    // The gateway's precedence reads the circuit flag straight out of context.
    expect(
      selectLevel({
        pin: "auto",
        budgetExhausted: false,
        circuitOpen: circuitOpenAt(state, NOW + CIRCUIT_FAILURE_THRESHOLD),
        latencyDegraded: false,
      }),
    ).toBe("L2");
  });

  it("admits one probe request once the open interval has elapsed", () => {
    const state = opened();
    const expiry = (state.untilMs as number) + 1;
    expect(circuitOpenAt(state, expiry)).toBe(false); // no longer blocked
    expect(probeAllowed(state, expiry)).toBe(true);
  });

  it("a successful probe closes the circuit", () => {
    const state = opened();
    const after = recordSuccess(state);
    expect(after.open).toBe(false);
    expect(after.reason).toBeNull();
    expect(after.untilMs).toBeNull();
    expect(circuitOpenAt(after, NOW)).toBe(false);
  });
});

describe("backoff doubles on each probe failure, capped at 30 minutes", () => {
  /**
   * Drive the circuit to its first open state, then fail each elapsed probe
   * and return the sequence of open-interval figures it chose.
   */
  function openIntervalsAfterProbes(): number[] {
    let state = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) state = recordFailure(state, NOW + i);
    const openInterval = state.openIntervalMs;

    const intervals: number[] = [];
    // Each probe must be admitted (elapsed) before it can fail → double.
    let t = state.untilMs as number;
    for (let probe = 0; probe < 4; probe++) {
      state = recordFailure(state, t);
      t = state.untilMs as number;
      intervals.push(state.openIntervalMs);
    }
    return [openInterval, ...intervals];
  }

  it("doubles the interval on each probe failure", () => {
    const intervals = openIntervalsAfterProbes();
    expect(intervals[0]).toBe(CIRCUIT_OPEN_BASE_MS); // initial open
    expect(intervals[1]).toBe(CIRCUIT_OPEN_BASE_MS * 2);
    expect(intervals[2]).toBe(CIRCUIT_OPEN_BASE_MS * 4);
  });

  it("never lets the interval exceed the 30-minute cap", () => {
    const intervals = openIntervalsAfterProbes();
    for (const interval of intervals) {
      expect(interval).toBeLessThanOrEqual(CIRCUIT_OPEN_MAX_MS);
    }
    // The doubling plateaus at the cap instead of overshooting.
    expect(intervals[3]).toBe(CIRCUIT_OPEN_MAX_MS);
    expect(intervals[4]).toBe(CIRCUIT_OPEN_MAX_MS);
  });

  it("reopens with a plain-language probe-failed reason", () => {
    let state = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) state = recordFailure(state, NOW + i);
    const reopened = recordFailure(state, state.untilMs as number);
    expect(reopened.open).toBe(true);
    expect(reopened.reason).toBe("circuit probe failed");
  });
});

describe("closing resets the backoff so the next open cycle starts fresh", () => {
  it("a probe success closes with the base interval ready for the next cycle", () => {
    let state = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) state = recordFailure(state, NOW + i);
    // Fail an elapsed probe so the interval has grown.
    state = recordFailure(state, state.untilMs as number);
    expect(state.openIntervalMs).toBe(CIRCUIT_OPEN_BASE_MS * 2);
    state = recordSuccess(state);
    expect(state.openIntervalMs).toBe(CIRCUIT_OPEN_BASE_MS);
    expect(state.consecutiveFailures).toBe(0);
  });
});