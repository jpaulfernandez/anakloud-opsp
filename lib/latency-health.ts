// Latency health for level selection (F12-T02, tech_infrastructure.md §6.1
// rule 4, spec.md §7). Pure functions, no I/O, no network — the same class of
// code as lib/validators.ts. Rule 4 is the least obvious of the four: a pin, an
// exhausted budget and an open circuit are each a stored or passed flag, but
// the "recent call latency" signal has to be *computed* from measurements.
// This module owns that computation (the gateway comment credits F12-T02 with
// it): given the per-call latencies of recent provider calls, it decides
// whether the p95 exceeds the 6s health threshold.
//
// The 6-second figure is not chosen to match the request timeout exactly — it
// is the same value because a provider that is slow enough to approach the
// timeout is already untrustworthy, and §10 criterion 7 ties "hint within 6s"
// to silently dropping a level. Measuring p95 rather than mean matters: a lone
// 9s stall in an otherwise fast set is a legitimately degraded view, and a mean
// would bury it.

/** How many most-recent calls the p95 window considers (tech_infrastructure §6.1). */
export const LATENCY_WINDOW = 20;

/**
 * Latency above this p95 flips the health flag to degraded — the 6s in §6.1.
 * Kept deliberately in lockstep with `PROVIDER_TIMEOUT_MS` (lib/provider.ts):
 * this module must not import the provider boundary (F12-T01's SDK-import
 * scan), so the shared figure is restated here with a why rather than reached
 * for across the boundary.
 */
export const LATENCY_HEALTH_THRESHOLD_MS = 6000;

/**
 * The nearest-rank 95th percentile of a set of latencies. The smallest value
 * such that at least 95% of observations are at or below it; for an empty set
 * there is no measurement, so it reports 0 and the degraded check stays false
 * (never degrade on the absence of data).
 */
export function p95Latency(latencies: readonly number[]): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const rank = Math.ceil(sorted.length * 0.95);
  return sorted[Math.min(rank, sorted.length) - 1];
}

/**
 * Whether the p95 latency over the most recent `LATENCY_WINDOW` calls exceeds
 * the threshold. The "last 20 calls" in §6.1 means the window is the *most
 * recent* calls, so a series longer than the window keeps only its tail.
 *
 * The comparison is strict: a p95 exactly at the threshold has not *exceeded*
 * 6 seconds, so it is not degraded.
 */
export function isLatencyDegraded(
  latencies: readonly number[],
  thresholdMs: number = LATENCY_HEALTH_THRESHOLD_MS,
): boolean {
  return p95Latency(latencies.slice(-LATENCY_WINDOW)) > thresholdMs;
}