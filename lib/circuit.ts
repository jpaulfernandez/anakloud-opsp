// The circuit breaker (F12-T03, spec.md §7.2, tech_infrastructure.md §6.1).
//
// A provider that fails or stalls three times in a row is untrustworthy, so
// the system stops paying for it: the circuit opens for a base interval, every
// model call is refused, and the level serves L2 (rule 3 in §6.1). When the
// open interval elapses the circuit admits one probe request — a single model
// call allowed through to see whether the provider recovered. A successful
// probe closes the circuit; a failed probe reopens it, with the interval
// doubled, capped at 30 minutes. That halving-to-open, doubling-while-unhealthy
// is the backoff policy the ticket's acceptances probe.
//
// The state machine below is pure — no I/O, no network — so three induced
// failures, the doubling ceiling, and the probe transitions are unit-testable
// without a database. Durable state (the open flag, the reason, and the
// absolute `until` timestamp) is persisted in `ai_budget`'s documented §3
// columns so it survives a process restart. The live consecutive-failure
// counter and the current open interval are process state kept here in memory
// — the same pattern as the gateway's latency window — because the §3 schema
// carries no columns for them and they only matter while a process is running
// to observe providers failing. A restarted process re-reads the open flag and
// `until` from the database and picks back up from the base interval.

import type { ClientBase } from "./db";

/** The base open interval (tech_infrastructure.md §6.1: "opens for 5 minutes"). */
export const CIRCUIT_OPEN_BASE_MS = 5 * 60 * 1000;

/** The cap on the backoff interval (§3.3: "capped at 30 minutes"). */
export const CIRCUIT_OPEN_MAX_MS = 30 * 60 * 1000;

/** How many consecutive provider failures open the circuit (§6.1 rule 5). */
export const CIRCUIT_FAILURE_THRESHOLD = 3;

/**
 * The full circuit state for one cohort. `open`/`reason`/`untilMs` are the
 * durable subset persisted to `ai_budget`; `openIntervalMs` and
 * `consecutiveFailures` are live process state used to compute the next
 * backoff interval and the open threshold.
 */
export interface CircuitSnapshot {
  /** Whether the circuit refuses model calls. */
  open: boolean;
  /** Plain-language reason, surfaced on the facilitator dashboard (F12-T07). */
  reason: string | null;
  /** Epoch ms when the current open interval elapses; null when closed. */
  untilMs: number | null;
  /** The current open interval — the figure that doubles on each reopen. */
  openIntervalMs: number;
  /** Consecutive provider failures while the circuit was closed. */
  consecutiveFailures: number;
}

/** The circuit's resting state: all model calls allowed, no reason or window. */
export function closedCircuit(): CircuitSnapshot {
  return {
    open: false,
    reason: null,
    untilMs: null,
    openIntervalMs: CIRCUIT_OPEN_BASE_MS,
    consecutiveFailures: 0,
  };
}

/**
 * Whether the circuit currently refuses model calls at `now`. The `open` flag
 * alone is not enough: once the open interval has elapsed the circuit is in
 * half-open state and must admit a probe, so the refusal window is `open` AND
 * the `until` deadline has not yet passed. This is what fills
 * `GatewayContext.circuitOpen`, so an elapsed open circuit stops blocking.
 */
export function circuitOpenAt(snapshot: CircuitSnapshot, now: number): boolean {
  return snapshot.open && (snapshot.untilMs === null || now < snapshot.untilMs);
}

/**
 * Whether a probe request may be admitted: the circuit is open and its open
 * interval has elapsed, so the next model call is the single recovery probe.
 */
export function probeAllowed(snapshot: CircuitSnapshot, now: number): boolean {
  return snapshot.open && snapshot.untilMs !== null && now >= snapshot.untilMs;
}

/**
 * Observe a provider failure at `now`. Three consecutive failures while the
 * circuit is closed open it for the base interval; a failure while it is open
 * is necessarily a probe failing, which reopens it with the interval doubled,
 * capped at `CIRCUIT_OPEN_MAX_MS`. While the circuit is fully open (before the
 * interval elapses) no model call is made, so the `open` branch can only be
 * reached by a probe whose window has already elapsed.
 */
export function recordFailure(snapshot: CircuitSnapshot, now: number): CircuitSnapshot {
  if (snapshot.open) {
    const nextInterval = Math.min(snapshot.openIntervalMs * 2, CIRCUIT_OPEN_MAX_MS);
    return {
      open: true,
      reason: "circuit probe failed",
      untilMs: now + nextInterval,
      openIntervalMs: nextInterval,
      consecutiveFailures: 0,
    };
  }
  return {
    ...snapshot,
    consecutiveFailures: snapshot.consecutiveFailures + 1,
    open: snapshot.consecutiveFailures + 1 >= CIRCUIT_FAILURE_THRESHOLD,
    reason: snapshot.consecutiveFailures + 1 >= CIRCUIT_FAILURE_THRESHOLD
      ? "three consecutive provider failures"
      : snapshot.reason,
    untilMs: snapshot.consecutiveFailures + 1 >= CIRCUIT_FAILURE_THRESHOLD
      ? now + CIRCUIT_OPEN_BASE_MS
      : snapshot.untilMs,
    openIntervalMs: snapshot.consecutiveFailures + 1 >= CIRCUIT_FAILURE_THRESHOLD
      ? CIRCUIT_OPEN_BASE_MS
      : snapshot.openIntervalMs,
  };
}

/**
 * Observe a provider success at `now` — only ever a probe result while the
 * circuit is open, since no other model call happens then. A probe success
 * closes the circuit. A success while closed resets the consecutive-failure
 * counter, because only *consecutive* failures should open it (§6.1).
 */
export function recordSuccess(snapshot: CircuitSnapshot): CircuitSnapshot {
  if (snapshot.open) return closedCircuit();
  return { ...snapshot, consecutiveFailures: 0 };
}

/**
 * Live, per-cohort circuit state for the running process. The durable `open` /
 * `reason` / `until` subset is persisted to `ai_budget`, but the consecutive-
 * failure counter and backoff interval have no §3 columns, so they live here —
 * in memory, keyed by cohort — and are re-seeded from the database on a cold
 * start (where they start from base values). Cleared on boot/restart, exactly
 * like the gateway's latency window.
 */
const liveState = new Map<string, CircuitSnapshot>();

/** Forget all live circuit state (tests/shutdown only; next load re-reads the DB). */
export function resetCircuitMemory(): void {
  liveState.clear();
}

/**
 * Read a cohort's circuit state, preferring the live in-memory copy (which
 * carries the counter and interval that drive the next transition) and falling
 * back to the persisted `ai_budget` subset. A cohort with no budget row yet
 * simply has a closed circuit.
 */
export async function loadCircuit(
  db: ClientBase,
  cohortId: string,
): Promise<CircuitSnapshot> {
  const cached = liveState.get(cohortId);
  if (cached !== undefined) return cached;

  const { rows } = await db.query(
    `select circuit_open, circuit_reason, circuit_until
       from ai_budget
      where cohort_id = $1`,
    [cohortId],
  );
  if (rows.length === 0) return closedCircuit();

  const persisted = rows[0];
  const snapshot: CircuitSnapshot = {
    open: persisted.circuit_open,
    reason: persisted.circuit_reason,
    untilMs: persisted.circuit_until
      ? new Date(persisted.circuit_until).getTime()
      : null,
    // The open interval is not persisted; a restarted process starts back at
    // the base figure and doubles from there on the next probe failure.
    openIntervalMs: CIRCUIT_OPEN_BASE_MS,
    consecutiveFailures: 0,
  };
  liveState.set(cohortId, snapshot);
  return snapshot;
}

/**
 * Persist a cohort's circuit state. Updates the live copy and writes the
 * durable subset (open, reason, until) to `ai_budget`, so an open circuit
 * survives a process restart. The budget row is created at cohort creation
 * (F12-T04 owns that); until then there is nothing to write to, which fails
 * loudly rather than silently dropping persistence.
 */
export async function saveCircuit(
  db: ClientBase,
  cohortId: string,
  snapshot: CircuitSnapshot,
): Promise<void> {
  liveState.set(cohortId, snapshot);
  const until = snapshot.untilMs === null ? null : new Date(snapshot.untilMs);
  const result = await db.query(
    `update ai_budget
        set circuit_open = $2,
            circuit_reason = $3,
            circuit_until = $4
      where cohort_id = $1`,
    [cohortId, snapshot.open, snapshot.reason, until],
  );
  if (result.rowCount === 0) {
    throw new Error(
      `no ai_budget row for cohort ${cohortId}; create it before persisting circuit state`,
    );
  }
}