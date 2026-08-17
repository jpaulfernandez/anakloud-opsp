// F14-T03/F14-T06 — the facilitator-analysis side panel's pure display model
// (FR-32, FR-35, ui_ux.md §4.19). The panel renders one or more labelled
// analysis runs beside the raw answers, and — at L2/L3 — the deterministic
// divergence breakdown as its own feature rather than as a downgrade.
//
// The same PR3 discipline as comparison-screen.ts and level-strip.ts: the
// string transformations and the "which panel do I show" decision live here,
// free of I/O, the DB and any provider, so the ticket's acceptance criteria
// are unit-testable without a browser or a model —
//
//   - the standing prep label is a fixed constant (ui_ux §4.19, verbatim),
//   - the footer timestamp formats deterministically from an ISO string
//     (FR-35: every output is labelled with the model used and a timestamp),
//   - the "model used" footer composes to timestamp-only when no model ran (the
//     deterministic branch), never an "unavailable" affordance,
//   - the serving level is recorded alongside the model and timestamp in every
//     footer (F14-T06: level recorded per output), and
//   - the read-vs-scoring decision reads only the served level.
//
// Client-safe by construction: only a `type` is imported, so nothing from the
// server config/provider graph is dragged into a client bundle.

import type { AnalysisServeBody } from "./analyse-endpoint";

/** The standing label on every output (ui_ux.md §4.19, verbatim). */
export const ANALYSIS_PREP_LABEL =
  "Prep material. Not a finding to show the team.";

/**
 * The deterministic panel's feature title. The L2/L3 replacement is presented
 * as its own feature (ui_ux.md §4.19), so the panel names it plainly rather
 * than framing it as a fallback or a degraded state.
 */
export const SCORING_PANEL_TITLE = "Divergence scoring";

/** The headline when a model-served read is being shown. */
export const ANALYSIS_PANEL_TITLE = "Analysis";

/**
 * Render an ISO timestamp into the durable footer form. Deterministic and UTC,
 * so a label produced here is stable across machines and relocating the value
 * next to a re-run can be asserted. Empty for an unparseable input, which keeps
 * a malformed value from painting "Invalid Date" onto a footer.
 */
export function formatAnalysisTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * The text in an output's footer label: the serving level recorded alongside
 * the model name and the generation timestamp (FR-35, F14-T06). When no model
 * ran — the deterministic branch — the model word is omitted and the label is
 * "level · timestamp"; a fabricated model name is never invented here.
 */
export function runFooterText(
  level: AnalysisServeBody["level"],
  model: string,
  generatedAt: string,
): string {
  const timestamp = formatAnalysisTimestamp(generatedAt);
  const bits: string[] = [level];
  if (model !== "") bits.push(model);
  if (timestamp !== "") bits.push(timestamp);
  return bits.join(" · ");
}

/**
 * One retained output as the panel renders it — a stable key plus the fully
 * labelled serve body, so model, timestamp and serving level ride with it.
 */
export interface LabelledRun {
  key: string;
  body: AnalysisServeBody;
}

/**
 * Turn the retained history (F14-T06) into the list of runs the panel shows,
 * in the given order — oldest first, so a re-run is always last. Pure, so the
 * "re-running preserves the prior output and its label" acceptance is
 * testable without a browser or a database.
 */
export function labelledRuns(history: readonly AnalysisServeBody[]): LabelledRun[] {
  return history.map((body, i) => ({ key: `run-${i}`, body }));
}

/** True when the serve was a full model-served read (L0) rather than deterministic. */
export function isAnalysisRead(body: AnalysisServeBody): boolean {
  return body.level === "L0";
}

/**
 * Format an agreement rate (0..1) as the whole-percent string shown in the
 * deterministic breakdown, or the em-dash placeholder where there is no rate
 * to report (open-text questions report manual review, not an agreement figure).
 */
export function percentLabel(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}