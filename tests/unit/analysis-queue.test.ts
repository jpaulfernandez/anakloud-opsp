import { beforeEach, describe, expect, it } from "vitest";
import {
  ANALYSIS_QUEUE_MAX_ATTEMPTS,
  clearAnalysisQueue,
  completedAnalysisCount,
  drainAnalysisQueue,
  enqueueAnalysis,
  getCompletedAnalysis,
  pendingAnalysisCount,
  type AnalysisQueueWork,
} from "../../lib/analysis-queue";
import type { AnalysisOutput } from "../../lib/analysis-prompt";

// F14-T02 acceptance 2: the L1 retry queue. help: "At L1 a queued analysis
// eventually completes without user action." That guarantee is the whole point
// of these tests — a queued analysis whose first attempt is degraded must
// re-run on its own and store its output, with no external nudge.

const KEY = "cohort:q8";

function anOutput(overrides: Partial<AnalysisOutput> = {}): AnalysisOutput {
  return {
    agreement: "The team shares the founding intent.",
    conflicts: [
      {
        between: "A and B",
        positions: ["PedConnect first.", "TeachDay first."],
      },
    ],
    askInRoom: ["What is the scarce resource, really?"],
    wordingNote: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearAnalysisQueue();
});

describe("enqueueAnalysis — a degraded first attempt retries on its own", () => {
  it("a queued analysis that fails once eventually completes without user action", async () => {
    let calls = 0;
    const output = anOutput();
    const work: AnalysisQueueWork = () =>
      Promise.resolve().then(() => {
        calls += 1;
        // First round degraded (model not ready), second round lands at L0.
        if (calls === 1) return { done: false, output: null };
        return { done: true, output };
      });

    enqueueAnalysis({ key: KEY, work, retryDelayMs: 5 });
    expect(pendingAnalysisCount()).toBe(1);

    await drainAnalysisQueue();

    expect(calls).toBe(2);
    expect(pendingAnalysisCount()).toBe(0);
    expect(getCompletedAnalysis(KEY)).toEqual(output);
  });

  it("stores nothing when the analysis never lands, and stops after the attempt budget", async () => {
    let calls = 0;
    const work: AnalysisQueueWork = () => {
      calls += 1;
      return Promise.resolve({ done: false, output: null });
    };

    enqueueAnalysis({
      key: KEY,
      work,
      maxAttempts: 2,
      retryDelayMs: 5,
    });

    await drainAnalysisQueue();

    expect(calls).toBe(2);
    expect(getCompletedAnalysis(KEY)).toBeUndefined();
    expect(pendingAnalysisCount()).toBe(0);
  });

  it("a job that lands on the first attempt stores its output in one round", async () => {
    const output = anOutput({ agreement: "Unanimous." });
    enqueueAnalysis({
      key: KEY,
      work: () => Promise.resolve({ done: true, output }),
      retryDelayMs: 5,
    });

    await drainAnalysisQueue();

    expect(getCompletedAnalysis(KEY)?.agreement).toBe("Unanimous.");
    expect(completedAnalysisCount()).toBe(1);
  });

  it("is idempotent on the key — a duplicate submit never stacks a second job", async () => {
    let calls = 0;
    const work: AnalysisQueueWork = () => {
      calls += 1;
      return Promise.resolve({ done: true, output: anOutput() });
    };

    enqueueAnalysis({ key: KEY, work, retryDelayMs: 5 });
    enqueueAnalysis({ key: KEY, work, retryDelayMs: 5 });
    await drainAnalysisQueue();

    // One job ran to completion; the second enqueue was a no-op.
    expect(calls).toBe(1);
    expect(pendingAnalysisCount()).toBe(0);
    expect(getCompletedAnalysis(KEY)).toEqual(anOutput());
  });
});

describe("the retry budget is bounded", () => {
  it("ANALYSIS_QUEUE_MAX_ATTEMPTS is the default ceiling", () => {
    expect(ANALYSIS_QUEUE_MAX_ATTEMPTS).toBe(3);
  });

  it("clearAnalysisQueue resets the queue between jobs", () => {
    enqueueAnalysis({
      key: KEY,
      work: () => Promise.resolve({ done: false, output: null }),
    });
    clearAnalysisQueue();
    expect(pendingAnalysisCount()).toBe(0);
    expect(completedAnalysisCount()).toBe(0);
    expect(getCompletedAnalysis(KEY)).toBeUndefined();
  });
});