// Divergence split thresholds, read from configuration with documented
// defaults (F10-T01, FR-31). The facilitator tunes these on the day after
// seeing real data (F10 README Risks, tracker blocker 5), so the values live
// here and in env, never inline at a call site.
//
// The defaults are chosen to land the seeded fixture (F01-T05) as intended:
// Q3 aligned on unit (spread 0), Q10 soft split on pricing model at low
// confidence, Q8 hard split on the door-opener ranking at high confidence.

export interface DivergenceConfig {
  /**
   * Spread (1 - agreement rate) at or below this counts as aligned. Default 0:
   * any divergence is a split, consensus is only "aligned" when every included
   * answer is the same.
   */
  alignedSpreadMax: number;
  /**
   * Mean confidence at or above this, with a real split present, classifies as
   * a hard split; anything below is a soft split. The seed's two camps sit on
   * either side: Q10 averages ~1.5 (soft), Q8 averages ~4.7 (hard).
   */
  hardSplitConfidenceMin: number;
}

/** The shipped defaults, before any environment override. */
export const DIVERGENCE_CONFIG_DEFAULTS: DivergenceConfig = {
  alignedSpreadMax: 0,
  hardSplitConfidenceMin: 4,
};

export const DIVERGENCE_ALIGNED_SPREAD_MAX_ENV =
  "DIVERGENCE_ALIGNED_SPREAD_MAX";
export const DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN_ENV =
  "DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN";

function parseFiniteNumber(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Resolve the effective thresholds from optional env overrides, falling back
 * to the documented defaults for anything unset or malformed. Kept separate
 * from `DIVERGENCE_CONFIG_DEFAULTS` so the classification functions themselves
 * stay free of I/O — a call site that wants tuning reaches for this loader,
 * a pure test passes a config object directly.
 */
export function loadDivergenceConfig(
  env: Record<string, string | undefined> = process.env,
): DivergenceConfig {
  return {
    alignedSpreadMax:
      parseFiniteNumber(env[DIVERGENCE_ALIGNED_SPREAD_MAX_ENV]) ??
      DIVERGENCE_CONFIG_DEFAULTS.alignedSpreadMax,
    hardSplitConfidenceMin:
      parseFiniteNumber(env[DIVERGENCE_HARD_SPLIT_CONFIDENCE_MIN_ENV]) ??
      DIVERGENCE_CONFIG_DEFAULTS.hardSplitConfidenceMin,
  };
}