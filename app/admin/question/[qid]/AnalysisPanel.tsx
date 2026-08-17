"use client";

import { useEffect, useRef, useState } from "react";
import {
  ANALYSIS_PANEL_TITLE,
  ANALYSIS_PREP_LABEL,
  isAnalysisRead,
  labelledRuns,
  percentLabel,
  runFooterText,
  SCORING_PANEL_TITLE,
  type LabelledRun,
} from "@/lib/analysis-panel";
import { divergenceBadgeLabel } from "@/lib/comparison-screen";
import type { AnalysisServeBody } from "@/lib/analyse-endpoint";
import { QUESTION_MAP, type QuestionId } from "@/lib/questions";

// F14-T03/F14-T06 — the facilitator-analysis side panel (FR-32, FR-35,
// ui_ux.md §4.19). It opens beside the raw answers and never replaces or
// obscures them; the layout, not this component, keeps the answers on screen
// next to it at every viewport width. It POSTs /api/admin/analyse for the
// current question and renders whichever serve the level dictates:
//
//   - L0: the model-served read — where they agree, where they don't, what to
//     ask in the room — with the model name and timestamp in the footer;
//   - L2/L3 (and L1, which serves the deterministic branch now and queues the
//     model in the background): the deterministic divergence breakdown with an
//     export button, presented as its own feature rather than as a downgrade.
//
// The deterministic panel carries no error language, no "unavailable" and no
// Retry affordance (ui_ux.md §4.19 / spec.md §7) — at L2 the server already
// returned a 200 with data, so there is nothing alarming to show.
//
// Re-run (FR-35, F14-T06) POSTs again and the endpoint returns the retained
// history — every previous output alongside the fresh one, each a fully
// labelled serve body. The panel renders that history, never replacing the
// earlier outputs, so a changed read is visible against what came before across
// page loads and sessions. Every run keeps its own footer — serving level,
// model and generation timestamp — satisfying "every output is labelled" and
// "the level is recorded per output". A response without a `history` array
// (a mock or an older server) falls back to appending the single fresh body,
// which keeps the F14-T03 client re-run behaviour intact.

export default function AnalysisPanel({ questionId }: { questionId: QuestionId }) {
  const [runs, setRuns] = useState<LabelledRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const keyRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch("/api/admin/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: questionId }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("analyse failed");
        return res.json() as Promise<AnalysisServeBody & { history?: AnalysisServeBody[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        if (body.history !== undefined) {
          // The server retained every output for this scope; render them all,
          // the fresh one last. Prior runs are preserved, not discarded.
          setRuns(labelledRuns(body.history));
        } else {
          // No history in the response — append the single fresh serve (the
          // F14-T03 re-run fallback), each run keeping its own label.
          setRuns((prev) => {
            const key = `run-${keyRef.current++}`;
            return [...prev, { key, body }];
          });
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [questionId, reload]);

  // Re-run is meaningful on a model-served read: at L2/L3 the panel is the
  // deterministic breakdown, which has nothing to regenerate.
  const latest = runs.length > 0 ? runs[runs.length - 1] : null;
  const latestIsRead = latest !== null && isAnalysisRead(latest.body);

  function rerun() {
    setReload((r) => r + 1);
  }

  return (
    <aside
      data-testid="analysis-panel"
      aria-label="Facilitator analysis"
      className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card lg:sticky lg:top-4 lg:self-start"
    >
      <header className="border-b border-neutral-100 pb-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-cobalt-700">
          {ANALYSIS_PANEL_TITLE}
        </h2>
        <p
          data-testid="analysis-prep-label"
          className="mt-1 text-xs text-neutral-500"
        >
          {ANALYSIS_PREP_LABEL}
        </p>
      </header>

      {loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 py-6 text-sm text-neutral-500 justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-cobalt-200 border-t-cobalt-600" />
          <p data-testid="analysis-loading">Loading…</p>
        </div>
      ) : null}

      {failed && runs.length === 0 ? (
        <p data-testid="analysis-error" className="py-4 text-xs font-medium text-neutral-500">
          Could not load the analysis.
        </p>
      ) : null}

      <ul data-testid="analysis-runs" className="mt-4 space-y-5">
        {runs.map((run) => (
          <li
            key={run.key}
            data-testid="analysis-run"
            className="border-t border-neutral-100 pt-4 first:border-0 first:pt-0"
          >
            {run.body.level === "L0" ? (
              <AnalysisRead body={run.body} />
            ) : (
              <ScoringRead body={run.body} />
            )}
            <footer
              data-testid="analysis-run-footer"
              className="mt-3 border-t border-neutral-100 pt-2"
            >
              <span
                data-testid="analysis-run-label"
                className="text-[11px] font-semibold tabular-nums text-neutral-400"
              >
                {runFooterText(
                  run.body.level,
                  run.body.label.model,
                  run.body.label.generatedAt,
                )}
              </span>
            </footer>
          </li>
        ))}
      </ul>

      {latestIsRead ? (
        <footer className="mt-5 border-t border-neutral-100 pt-3">
          <button
            type="button"
            data-testid="analysis-rerun"
            disabled={loading}
            onClick={rerun}
            className="inline-flex min-h-[36px] items-center justify-center rounded-xl bg-cobalt-50 px-3.5 py-1.5 text-xs font-semibold text-cobalt-700 shadow-subtle hover:bg-cobalt-100/80 disabled:opacity-50 transition-all"
          >
            Re-run
          </button>
        </footer>
      ) : null}
    </aside>
  );
}

/** The model-served read (L0): where they agree / don't / ask in the room. */
function AnalysisRead({ body }: { body: AnalysisServeBody }) {
  if (body.level !== "L0") return null;
  const a = body.analysis;
  return (
    <section data-testid="analysis-read" className="space-y-4">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          Where you agree
        </h3>
        <p data-testid="analysis-agreement" className="mt-1.5 text-xs leading-relaxed text-neutral-800 bg-neutral-50/70 p-3 rounded-xl border border-neutral-100">
          {a.agreement}
        </p>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          {"Where you don't"}
        </h3>
        {a.conflicts.length === 0 ? (
          <p className="mt-1 text-xs text-neutral-500 italic">No conflicts surfaced.</p>
        ) : (
          <ul data-testid="analysis-conflicts" className="mt-1.5 space-y-2">
            {a.conflicts.map((c, i) => (
              <li key={i} className="text-xs text-neutral-800 rounded-xl bg-neutral-50/70 p-3 border border-neutral-100">
                <span className="font-bold text-neutral-900">{c.between}:</span>
                <ul className="ml-3 mt-1.5 list-disc space-y-1 pl-3 text-neutral-700">
                  {c.positions.map((p, j) => (
                    <li key={j} data-testid="analysis-conflict-position">
                      {p}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {a.wordingNote ? (
          <p
            data-testid="analysis-wording-note"
            className="mt-2 text-xs italic text-neutral-500"
          >
            {a.wordingNote}
          </p>
        ) : null}
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500">
          What to ask in the room
        </h3>
        <ul data-testid="analysis-ask-in-room" className="mt-1.5 list-disc pl-4 text-xs space-y-1 text-neutral-800">
          {a.askInRoom.map((q, i) => (
            <li key={i}>{q}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The deterministic divergence breakdown (L1/L2/L3) — its own feature, not a
 * downgrade. No model name (none ran), no error language, no Retry affordance;
 * just the read and the export options.
 */
function ScoringRead({ body }: { body: AnalysisServeBody }) {
  if (body.level === "L0") return null;
  const scoring = body.scoring;
  return (
    <section
      data-testid="deterministic-panel"
      role="region"
      aria-label={SCORING_PANEL_TITLE}
      className="space-y-3"
    >
      <h3 data-testid="scoring-title" className="text-xs font-bold uppercase tracking-wider text-neutral-500">
        {SCORING_PANEL_TITLE}
      </h3>
      <ul data-testid="scoring-entries" className="space-y-3">
        {scoring.results.map((r) => {
          const definition = QUESTION_MAP[r.questionId];
          const badge = divergenceBadgeLabel(r.category);
          return (
            <li
              key={r.questionId}
              data-testid="scoring-entry"
              className="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-neutral-900">
                  {definition.section}
                </span>
                {badge !== null ? (
                  <span className="rounded-full bg-cobalt-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-subtle">
                    {badge}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-neutral-700 font-medium">{definition.text}</p>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-neutral-600">
                <div className="flex justify-between">
                  <dt>Included</dt>
                  <dd data-testid="scoring-included" className="font-semibold tabular-nums text-neutral-900">
                    {r.included}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Private excluded</dt>
                  <dd className="font-semibold tabular-nums text-neutral-900">{r.privateExcluded}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Agreement</dt>
                  <dd data-testid="scoring-agreement" className="font-semibold tabular-nums text-neutral-900">
                    {percentLabel(r.agreementRate)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>Spread</dt>
                  <dd className="font-semibold tabular-nums text-neutral-900">{percentLabel(r.spread)}</dd>
                </div>
                {r.meanConfidence !== null ? (
                  <div className="flex justify-between">
                    <dt>Avg confidence</dt>
                    <dd className="font-semibold tabular-nums text-neutral-900">{r.meanConfidence}</dd>
                  </div>
                ) : null}
              </dl>
              {r.mode === "open" && r.wordCounts !== null ? (
                <p className="mt-2 text-[11px] text-neutral-400">
                  Word counts: {r.wordCounts.join(", ")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div data-testid="scoring-exports" className="flex flex-wrap gap-2 pt-2">
        <a
          data-testid="scoring-export-csv"
          href={scoring.exportOptions.csv}
          className="inline-flex min-h-[36px] items-center justify-center rounded-xl bg-cobalt-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 transition-all"
        >
          Export CSV
        </a>
        <a
          data-testid="scoring-export-projection"
          href={scoring.exportOptions.projection}
          className="inline-flex min-h-[36px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 transition-all"
        >
          Projection sheet
        </a>
      </div>
    </section>
  );
}