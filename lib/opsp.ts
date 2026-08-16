// The deterministic answer→OPSP mapping (F07-T01, FR-22, PR3, spec.md §10
// criterion 6, anakloud-baseline-questions.md Part B). A pure function: no I/O,
// no network, never an AI call. Given a respondent's snapshot (the frozen
// answer rows POST /api/submit captured, keyed by question id) it produces the
// sixteen OPSP cells. Identical answers produce identical cells.
//
// The sixteen cells, their source questions and their ink/pencil defaults all
// come verbatim from Part B. Two details there are load-bearing and built in
// from the start rather than special-cased later:
//   * Four cells default to pencil regardless of confidence — BHAG, Brand
//     Promise, Profit per X, 1-Year Critical Number. They are pre-beta guesses
//     by nature, so a pencil default is a floor that confidence can push toward
//     but never away from.
//   * 3-Year Targets carries a per-part mark: ink on the metric, pencil on the
//     number. The cell model therefore marks by *part*, not by cell, so the
//     renderer (F07-T03) can draw the mixed mark and F08's print stylesheet can
//     depend on it existing here.
//
// Low confidence is grounded in the Part C soft-split convention (seed's
// PART_C_SOFT_CONFIDENCE = 2): confidence ≤ 2 counts as low. Any feeding
// answer marked low pushes an ink-default cell to pencil.
//
// The private q14d note is deliberately absent from every cell. No Part B cell
// reads it, so the mapping never touches the "q14d" key and the note cannot
// leak from a respondent's own snapshot into the plan.

import type { QuestionId } from "./questions";
import { CONFIDENCE_QUESTION_IDS, type ConfidenceQuestionId } from "./confidence";

/** Ink vs pencil, as authored in Part B and refined by confidence (FR-24). */
export type OpspMark = "ink" | "pencil";

/** One part's mark. A cell marks by part so 3-Year Targets can carry a split. */
export interface OpspPart {
  /** The renderer key this mark applies to within the cell value. */
  key: string;
  mark: OpspMark;
}

/** How a cell is marked: a single whole-cell mark, or per-part marks. */
export type OpspMarking =
  | { type: "single"; mark: OpspMark }
  | { type: "parts"; parts: OpspPart[] };

/** A single OPSP cell, as a JSON-serialisable map entry. */
export interface OpspCell {
  /** The fed answer fragments; null when the cell has nothing to show. */
  value: unknown;
  marking: OpspMarking;
  /** The question ids that fed this cell (provenance, F07-T02). */
  sources: QuestionId[];
  /**
   * True when a confidence-bearing feeding answer recorded low confidence.
   * Stored rather than recomputed so the renderer (F07-T03) can tell a
   * low-confidence pencil cell from Part B's editorial pencil defaults, and
   * later OPSP edits (F07-T05) keep the distinction across versions.
   */
  lowConfidence: boolean;
}

/**
 * The sixteen Part B cells, in their table order. Exactly these — no
 * seventeenth — is an asserted invariant (F07-T01 acceptance).
 */
export const OPSP_CELL_IDS = [
  "core_values",
  "purpose",
  "bhag",
  "three_year_targets",
  "sandbox_core_customer",
  "sandbox_boundaries",
  "brand_promise",
  "profit_per_x",
  "year1_critical_number",
  "key_initiatives",
  "quarterly_theme",
  "quarterly_rocks",
  "number1_priority",
  "accountability_face",
  "swt_threats",
  "capacity",
] as const;
export type OpspCellId = (typeof OPSP_CELL_IDS)[number];

/** The minimum whole number confidence that still counts as low (≤ this). */
export const OPSP_LOW_CONFIDENCE = 2;

/** A source answer as the mapping reads it from a snapshot. */
export interface OpspSourceAnswer {
  value: unknown;
  confidence: number | null;
}

/**
 * The snapshot shape the mapping consumes: answers keyed by question id. The
 * submit path's SnapshotPayload is structurally assignable to this.
 */
export type OpspSourceAnswers = Record<string, OpspSourceAnswer | undefined>;

/** Part B's ink/pencil default for a cell, before confidence is considered. */
export type OpspDefaultMark = OpspMark | "split";

interface CellSpec {
  id: OpspCellId;
  sources: QuestionId[];
  defaultMark: OpspDefaultMark;
  /** Derive the cell's value from the snapshot; null when nothing is present. */
  derive: (snapshot: OpspSourceAnswers) => unknown | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value fragment helpers. Each targets the §3.1 answer shape for its question
// and returns a non-empty fragment or null, so an absent or structurally
// incomplete answer leaves the cell empty instead of being filled with filler.
// ─────────────────────────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Obj)
    : null;
}

const isStr = (v: unknown): v is string => typeof v === "string";

function textFragment(v: unknown): { text: string } | null {
  const o = obj(v);
  if (!o || !isStr(o.text)) return null;
  return { text: o.text };
}

function q3Fragment(v: unknown): { metric: string; value: number; unit: string } | null {
  const o = obj(v);
  if (
    !o ||
    !isStr(o.metric) ||
    typeof o.value !== "number" ||
    !Number.isFinite(o.value) ||
    !isStr(o.unit)
  ) {
    return null;
  }
  return { metric: o.metric, value: o.value, unit: o.unit };
}

function q2Fragment(v: unknown): { who: string; because: string } | null {
  const o = obj(v);
  if (!o || !isStr(o.who) || !isStr(o.because)) return null;
  return { who: o.who, because: o.because };
}

function q5Fragment(v: unknown): Obj | null {
  const o = obj(v);
  if (!o) return null;
  const fragment: Obj = {};
  for (const key of ["pays", "decides", "uses", "benefits"]) {
    if (Array.isArray(o[key])) fragment[key] = o[key];
  }
  return Object.keys(fragment).length > 0 ? fragment : null;
}

function q6Fragment(v: unknown): { choice: string; why: string } | null {
  const o = obj(v);
  if (!o || !isStr(o.choice) || !isStr(o.why)) return null;
  return { choice: o.choice, why: o.why };
}

function q8RankFragment(v: unknown): { rank: unknown } | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.rank) || o.rank.length === 0) return null;
  return { rank: o.rank };
}

function q9Fragment(v: unknown): { items: unknown } | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.items)) return null;
  return { items: o.items };
}

function q10Fragment(v: unknown): Obj | null {
  const o = obj(v);
  if (!o) return null;
  const fragment: Obj = {};
  for (const key of ["payer", "model", "amount", "unit", "first_peso"]) {
    if (o[key] !== undefined) fragment[key] = o[key];
  }
  return Object.keys(fragment).length > 0 ? fragment : null;
}

function q10FirstPesoFragment(v: unknown): { first_peso: string } | null {
  const o = obj(v);
  if (!o || !isStr(o.first_peso)) return null;
  return { first_peso: o.first_peso };
}

function q11Fragment(v: unknown): { rocks: unknown } | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.rocks)) return null;
  return o.rocks.length > 0 ? { rocks: o.rocks } : null;
}

function q11StarredFragment(v: unknown): unknown | null {
  const o = obj(v);
  if (!o || !Array.isArray(o.rocks) || typeof o.starred !== "number") return null;
  const rock = o.rocks[o.starred];
  return rock !== undefined ? rock : null;
}

function q13Fragment(v: unknown): { text: string; cause: string } | null {
  const o = obj(v);
  if (!o || !isStr(o.text) || !isStr(o.cause)) return null;
  return { text: o.text, cause: o.cause };
}

function q14AccountabilityFragment(v: unknown): Obj | null {
  const o = obj(v);
  if (!o) return null;
  const fragment: Obj = {};
  if (Array.isArray(o.wants)) fragment.wants = o.wants;
  if (o.others && typeof o.others === "object") fragment.others = o.others;
  return Object.keys(fragment).length > 0 ? fragment : null;
}

function q14CapacityFragment(v: unknown): { hours: number } | null {
  const o = obj(v);
  if (!o || typeof o.hours !== "number" || !Number.isFinite(o.hours)) return null;
  return { hours: o.hours };
}

/** Wrap one source question's fragment under the source id, or null. */
function single(snapshot: OpspSourceAnswers, id: string, toFrag: (v: unknown) => unknown | null): unknown | null {
  const v = snapshot[id]?.value;
  if (v === undefined) return null;
  const frag = toFrag(v);
  return frag === null ? null : { [id]: frag };
}

/**
 * Combine several sources' fragments under each source id. Every present source
 * contributes its own key; a cell is empty (null) only when no source has a
 * fragment to show, so one missing source never erases the rest.
 */
function combine(
  snapshot: OpspSourceAnswers,
  pairs: ReadonlyArray<[string, (v: unknown) => unknown | null]>,
): unknown | null {
  const out: Obj = {};
  let any = false;
  for (const [id, toFrag] of pairs) {
    const v = snapshot[id]?.value;
    if (v === undefined) continue;
    const frag = toFrag(v);
    if (frag !== null) {
      out[id] = frag;
      any = true;
    }
  }
  return any ? out : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The sixteen cell specs, in the Part B table's order. `sources` and
// `defaultMark` are the two columns of that table; `derive` builds the value.
// ─────────────────────────────────────────────────────────────────────────────

const OPSP_CELL_SPECS: readonly CellSpec[] = [
  { id: "core_values", sources: ["q15"], defaultMark: "ink", derive: (s) => single(s, "q15", textFragment) },
  { id: "purpose", sources: ["q1", "q2"], defaultMark: "ink", derive: (s) => combine(s, [["q1", textFragment], ["q2", q2Fragment]]) },
  { id: "bhag", sources: ["q4"], defaultMark: "pencil", derive: (s) => single(s, "q4", textFragment) },
  { id: "three_year_targets", sources: ["q3"], defaultMark: "split", derive: (s) => single(s, "q3", q3Fragment) },
  { id: "sandbox_core_customer", sources: ["q5", "q6"], defaultMark: "ink", derive: (s) => combine(s, [["q5", q5Fragment], ["q6", q6Fragment]]) },
  { id: "sandbox_boundaries", sources: ["q9"], defaultMark: "ink", derive: (s) => single(s, "q9", q9Fragment) },
  { id: "brand_promise", sources: ["q7"], defaultMark: "pencil", derive: (s) => single(s, "q7", textFragment) },
  { id: "profit_per_x", sources: ["q10"], defaultMark: "pencil", derive: (s) => single(s, "q10", q10Fragment) },
  { id: "year1_critical_number", sources: ["q10", "q3"], defaultMark: "pencil", derive: (s) => combine(s, [["q10", q10FirstPesoFragment], ["q3", q3Fragment]]) },
  { id: "key_initiatives", sources: ["q8"], defaultMark: "ink", derive: (s) => single(s, "q8", q8RankFragment) },
  { id: "quarterly_theme", sources: ["q12"], defaultMark: "ink", derive: (s) => single(s, "q12", textFragment) },
  { id: "quarterly_rocks", sources: ["q11"], defaultMark: "ink", derive: (s) => single(s, "q11", q11Fragment) },
  { id: "number1_priority", sources: ["q11"], defaultMark: "ink", derive: (s) => single(s, "q11", q11StarredFragment) },
  { id: "accountability_face", sources: ["q14"], defaultMark: "ink", derive: (s) => single(s, "q14", q14AccountabilityFragment) },
  { id: "swt_threats", sources: ["q13"], defaultMark: "ink", derive: (s) => single(s, "q13", q13Fragment) },
  { id: "capacity", sources: ["q14"], defaultMark: "ink", derive: (s) => single(s, "q14", q14CapacityFragment) },
];

const CELL_SPEC_MAP: Record<OpspCellId, CellSpec> = OPSP_CELL_SPECS.reduce(
  (acc, spec) => {
    acc[spec.id] = spec;
    return acc;
  },
  {} as Record<OpspCellId, CellSpec>,
);

/** True when a present confidence-bearing source recorded low confidence. */
function sourceIsLow(snapshot: OpspSourceAnswers, id: QuestionId): boolean {
  const entry = snapshot[id];
  if (!entry) return false;
  const c = entry.confidence;
  return c !== null && c <= OPSP_LOW_CONFIDENCE;
}

/** Resolve a cell's marking from its Part B default, emptiness and confidence. */
function resolveMarking(
  defaultMark: OpspDefaultMark,
  empty: boolean,
  lowConfidence: boolean,
): OpspMarking {
  if (defaultMark === "split") {
    // 3-Year Targets: ink on the metric, pencil on the number. The number is
    // pencil regardless; the metric drops to pencil when Q3 is absent or low.
    const metric = empty || lowConfidence ? "pencil" : "ink";
    return {
      type: "parts",
      parts: [
        { key: "metric", mark: metric },
        { key: "number", mark: "pencil" },
      ],
    };
  }
  if (defaultMark === "pencil") {
    // A pencil default is a floor — confidence never upgrades it to ink.
    return { type: "single", mark: "pencil" };
  }
  return { type: "single", mark: empty || lowConfidence ? "pencil" : "ink" };
}

/** Derive one cell from a source snapshot. */
function deriveCell(id: OpspCellId, snapshot: OpspSourceAnswers): OpspCell {
  const spec = CELL_SPEC_MAP[id];
  const value = spec.derive(snapshot);
  const empty = value === null;
  const lowConfidence = spec.sources.some(
    (q) =>
      CONFIDENCE_QUESTION_IDS.includes(q as ConfidenceQuestionId) &&
      sourceIsLow(snapshot, q),
  );
  return {
    value,
    marking: resolveMarking(spec.defaultMark, empty, lowConfidence),
    sources: [...spec.sources],
    lowConfidence,
  };
}

/**
 * Build a respondent's OPSP cells deterministically from their snapshot.
 * All sixteen Part B cells are always present (empty cells carry `value: null`
 * and a pencil mark), so a respondent who skipped optional questions sees
 * blanks, not filler.
 */
export function buildOpspCells(snapshot: OpspSourceAnswers): Record<OpspCellId, OpspCell> {
  const cells = {} as Record<OpspCellId, OpspCell>;
  for (const id of OPSP_CELL_IDS) {
    cells[id] = deriveCell(id, snapshot);
  }
  return cells;
}