// F14-T02 — the L1 background retry queue (spec.md §7: at L1 the facilitator
// analysis is "queued, retried in background").
//
// tech_infrastructure.md §1 deliberately excludes a real queue — Redis, SQS,
// a worker fleet — because at n=6 a queue adds failure modes and no capability.
// This module is that queue: a process-local scheduler that re-runs a queued
// analysis on a short backoff until the model call succeeds or the attempt
// budget is spent. It is the mechanism behind "a queued analysis eventually
// completes without user action" (F14-T02 acceptance 2).
//
// Process-local by design, exactly like the gateway's latency window and the
// circuit's live state: a retry is only meaningful while this process is
// running. A completed analysis lands in an in-memory store keyed by job key;
// durable retention and re-fetch of past outputs is a later ticket (F14-T06),
// so until then the store exists so the queue is observable and testable and
// the side panel (F14-T03) has a place to read a finished read from.
//
// The scheduler is deterministic: exactly one attempt at a time, backoff
// between rounds, a hard attempt ceiling. Nothing here touches the network or
// the database — the `work` closure owns that, so the retry policy is
// unit-testable without either.

import type { AnalysisOutput } from "./analysis-prompt";

/** How long to wait between retry rounds (ms). A chosen default, made explicit. */
export const ANALYSIS_QUEUE_RETRY_DELAY_MS = 2000;

/** The hard ceiling on retry rounds for one job (first attempt plus retries). */
export const ANALYSIS_QUEUE_MAX_ATTEMPTS = 3;

/** What one retry attempt reports back to the scheduler. */
export interface AnalysisQueueWorkResult<T = AnalysisOutput> {
  /**
   * True only when a real model-served analysis was produced (the level that
   * actually served the call was L0). A degraded round reports `done: false`
   * so the scheduler tries again.
   */
  done: boolean;
  /** The produced analysis, present exactly when `done` is true. */
  output: T | null;
}

/** The unit of queueable work: re-run one analysis, report whether it landed. */
export type AnalysisQueueWork<T = AnalysisOutput> = () => Promise<AnalysisQueueWorkResult<T>>;

/** A queued analysis job. The same key may only be queued once. */
export interface AnalysisQueueJob<T = AnalysisOutput> {
  /** A cohort-scoped identity, e.g. "cohortId:questionId"; enqueued once. */
  key: string;
  /** Re-runs the analysis; the scheduler calls it once per attempt. */
  work: AnalysisQueueWork<T>;
  /** Attempt ceiling for this job; defaults to ANALYSIS_QUEUE_MAX_ATTEMPTS. */
  maxAttempts?: number;
  /** Backoff between rounds for this job; defaults to the module constant. */
  retryDelayMs?: number;
}

/**
 * Completed job results, keyed by job key — read by the panel (F14-T03) and the
 * test seams. The store is untyped at the boundary because different keys hold
 * different output shapes (the cohort read, the individual-OPSP read); the
 * generic `getCompletedAnalysis<T>` recovers the caller's shape on read.
 */
const completed = new Map<string, unknown>();
/** Keys whose job is awaiting its next attempt. */
const pending = new Set<string>();
/** Outstanding attempt timers, so a terminal path can clear its own. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Outstanding active rounds; drains to zero when every job has settled. */
let activeRounds = 0;
/** Resolvers waiting for the queue to settle (tests). */
const drainResolvers: Array<() => void> = [];

function trackStart(): void {
  activeRounds += 1;
}

function trackEnd(): void {
  activeRounds -= 1;
  if (activeRounds <= 0) {
    for (const resolve of drainResolvers) resolve();
    drainResolvers.length = 0;
  }
}

/** Resolve/reset one job's terminal state and withdraw its timer, if any. */
function settle(key: string): void {
  const timer = timers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(key);
  }
  pending.delete(key);
  trackEnd();
}

function runAttempt<T>(key: string, job: AnalysisQueueJob<T>, attempt: number): void {
  job.work().then((result) => {
    if (result.done) {
      if (result.output !== null) completed.set(key, result.output);
      settle(key);
    } else if (attempt >= (job.maxAttempts ?? ANALYSIS_QUEUE_MAX_ATTEMPTS)) {
      // The attempt budget is spent and the model still did not run. The job is
      // left un-completed; the deterministic result already served the
      // facilitator when the job was queued, so "give up" is informational, not
      // a failure surface.
      settle(key);
    } else {
      timers.set(
        key,
        setTimeout(
          () => runAttempt(key, job, attempt + 1),
          job.retryDelayMs ?? ANALYSIS_QUEUE_RETRY_DELAY_MS,
        ),
      );
    }
  });
}

/**
 * Queue an analysis for background retry. Idempotent on `key`: a key that is
 * already pending (or already completed) is left alone, so a double-submit —
 * or an L1 round while a round is in flight — never stacks jobs. Returns
 * immediately; the retries run off the event loop with no user action.
 */
export function enqueueAnalysis<T = AnalysisOutput>(job: AnalysisQueueJob<T>): void {
  if (pending.has(job.key) || completed.has(job.key)) return;
  pending.add(job.key);
  trackStart();
  runAttempt(job.key, job, 1);
}

/** Read a completed analysis, when one has landed. */
export function getCompletedAnalysis<T = AnalysisOutput>(key: string): T | undefined {
  return completed.get(key) as T | undefined;
}

/** How many jobs are still awaiting a retry round. */
export function pendingAnalysisCount(): number {
  return pending.size;
}

/** How many analyses have completed in this process. */
export function completedAnalysisCount(): number {
  return completed.size;
}

/**
 * Resolve when every queued job has settled (completed or given up). Used by
 * tests to turn the async L1 queue into a deterministic assertion point.
 */
export async function drainAnalysisQueue(): Promise<void> {
  if (activeRounds === 0) return;
  await new Promise<void>((resolve) => drainResolvers.push(resolve));
}

/** Forget all queued and completed state (tests only). */
export function clearAnalysisQueue(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  pending.clear();
  completed.clear();
  drainResolvers.length = 0;
  activeRounds = 0;
}