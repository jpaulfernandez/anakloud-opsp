import {
  Q5_ROLE_IDS,
  type Q5Value,
  type RoleId,
} from "./questions";

// Pure matrix-grid helpers (F03-T05, ui_ux.md §4.8, anakloud-baseline-questions.md
// Q5). No I/O, no network — the four columns, the nine role labels, the per-cell
// toggle and the "answered" rule are deterministic so they can be unit-tested
// without a browser and so the shell's forward-navigation decision stays pure.
//
// Q5 asks which of four things each of nine roles does for the product: who
// pays us, who decides to adopt, who uses it most days, who benefits most. A
// role can be marked in more than one column, or in none (ui_ux §4.8), so the
// stored §3.1 shape is four arrays of role ids, `{ pays, decides, uses,
// benefits }`. The question is structurally constrained and therefore not
// coached (spec.md §6.3); it differs structurally from the metric triple in
// that its draft and its stored payload are the same object — there is no
// free-text or number part that needs normalising en route.

/** The four columns, in the order the baseline and ui_ux specify. */
export const Q5_COLUMNS = ["pays", "decides", "uses", "benefits"] as const;
export type Q5Column = (typeof Q5_COLUMNS)[number];

/** The display label for each column, verbatim from the ticket/baseline. */
export const Q5_COLUMN_LABELS: Record<Q5Column, string> = {
  pays: "Pays us",
  decides: "Decides to adopt",
  uses: "Uses it most days",
  benefits: "Benefits most",
};

/**
 * The display label for each of the nine roles, verbatim from the ticket
 * (and anakloud-baseline-questions.md Q5). These are the row labels in the
 * grid and the option labels in each column of the pivot.
 */
export const Q5_ROLE_LABELS: Record<RoleId, string> = {
  pediatrician: "Pediatrician / developmental pedia",
  center_owner: "Therapy center owner or director",
  occupational_therapist: "Occupational therapist",
  speech_pathologist: "Speech-language pathologist",
  parent: "Parent or guardian",
  school_sped: "School or SPED teacher",
  child: "The child",
  lgu_doh: "LGU or DOH program",
  hmo_insurer: "HMO or insurer",
};

// The registry order is the only ordering a multi-select payload carries. Roles
// are sorted by it on every write so the stored arrays are identical regardless
// of which presentation set them and in what order — the grid and the pivot
// must "write identical payloads for identical selections" (F03-T05).
const ROLE_ORDER = new Map(Q5_ROLE_IDS.map((id, i) => [id, i]));

function sortedRoleIds(ids: readonly RoleId[]): RoleId[] {
  return [...ids].sort((a, b) => ROLE_ORDER.get(a)! - ROLE_ORDER.get(b)!);
}

/**
 * Flip whether `role` is marked under `column` in `value`, returning a new
 * value with the arrays held in registry order. Used by both the grid checkbox
 * and the pivot multi-select, so the two always write the same payload.
 */
export function toggleRole(
  value: Q5Value,
  column: Q5Column,
  role: RoleId,
): Q5Value {
  const current = value[column];
  const removed = current.includes(role);
  const next = sortedRoleIds(
    removed ? current.filter((r) => r !== role) : [...current, role],
  );
  return { ...value, [column]: next };
}

/**
 * Whether a matrix value counts as an answer (Q5 is required, F03-T05). Roles
 * may be marked in none of the columns — that is the whole point of the "or
 * none" column (ui_ux §4.8) — so the question is answered the moment the
 * respondent has marked *any* role in *any* column. An entirely empty matrix
 * is unanswered and blocks Continue.
 */
export function matrixGridIsAnswered(value: Q5Value): boolean {
  return Q5_COLUMNS.some((column) => value[column].length > 0);
}