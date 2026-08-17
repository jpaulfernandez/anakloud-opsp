import { APP_IDS, type AppId, type Q8Value } from "./questions";

// Pure tap-to-assign ranking helpers (F03-T07, ui_ux.md §4.7, §7,
// anakloud-baseline-questions.md Q8). No I/O, no network — the pool
// permutation, the app labels, the "answered" rule and the stored-value mapping
// are deterministic so they can be unit-tested without a browser and so the
// shell's forward-navigation decision stays pure (the same discipline as the
// other F03 libs).
//
// Q8 is "the hard one on mobile" (ui_ux §4.7). Drag-and-drop on touch is
// fragile, so the ranking is built by tapping: each tap moves a pool card into
// an ordered list with its position number, and an ✕ returns it to the pool.
// The stored §3.1 shape is `{ rank, delete, why, predicted }` — the ordered app
// ids, which app to delete, a one-line why, and the respondent's prediction of
// the group's #1.
//
// The pool order must be randomised per respondent — a fixed order subtly
// signals a default ranking (ui_ux §4.7, AGENTS.md rule 1). Because there is no
// persistence yet, the shuffle is seeded deterministically from the
// respondent's identity, so two respondents in the same cohort see different
// pool orders while a single respondent keeps a stable order across reloads.

/** Display labels for the four apps. */
export const APP_LABELS: Record<AppId, string> = {
  pedconnect: "PedConnect",
  pedmd: "PedMD",
  parentup: "ParentUp",
  teachday: "TeachDay",
};

/**
 * A small deterministic string hash (FNV-1a) so a respondent id can seed the
 * pool shuffle. Anything reversible enough to distinguish respondents is fine;
 * this is not security, just a stable non-random-looking spread.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** A tiny seeded PRNG (mulberry32), so the shuffle is reproducible from a seed. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The four app ids in a deterministic per-respondent order. Two distinct seeds
 * (respondent ids) produce distinct pool orders, so the pool is *not* a fixed
 * default ranking for the cohort; the same seed always produces the same order
 * for that respondent. Result is always a permutation of APP_IDS (Fisher-Yates).
 */
export function shufflePool(seed: string): AppId[] {
  const rng = mulberry32(fnv1a(seed));
  const pool = [...APP_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

/**
 * Q8 while the respondent is still working. `delete` is null until one of the
 * four apps is chosen, so an unstarted question reads as unanswered rather than
 * defaulting to one of the apps — the same reason the other drafts keep empty
 * choices null.
 */
export interface RankingDraft {
  /** The ordered app ids, first to last. */
  rank: AppId[];
  /** Which app to delete, or null until chosen. */
  delete: AppId | null;
  /** The one-line why, paired with the delete choice. */
  why: string;
  /** The respondent's predicted group ranking (the collapsed "predict" field). */
  predicted: AppId[];
}

/**
 * Whether a ranking draft counts as an answer (Q8 is required, F03-T07). All
 * four halves must be present: a complete ordering of all four apps, a delete
 * choice, a non-blank why, and a complete prediction. A partial ordering is not
 * an answer — Q8 is "which door opens first", and arriving at that needs a full
 * rank and a decision about what to drop.
 */
export function rankingIsAnswered(value: RankingDraft): boolean {
  return (
    value.rank.length === APP_IDS.length &&
    value.delete !== null &&
    value.why.trim() !== "" &&
    value.predicted.length === APP_IDS.length
  );
}

/**
 * The stored §3.1 shape once the draft holds a delete choice. The caller
 * guarantees a choice exists (an answered draft has `delete !== null`), so this
 * maps the four-part draft onto the `{ rank, delete, why, predicted }` the
 * registry types Q8 with.
 */
export function toRankingValue(draft: RankingDraft): Q8Value {
  if (draft.delete === null) {
    throw new Error("cannot map an unanswered ranking draft to a value");
  }
  return {
    rank: draft.rank,
    delete: draft.delete,
    why: draft.why,
    predicted: draft.predicted,
  };
}