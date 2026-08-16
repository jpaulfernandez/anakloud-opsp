import {
  FUNCTION_IDS,
  Q14_QUESTION_IDS,
  type FunctionId,
  type Q14Value,
} from "./questions";
import type { CohortMember } from "./cohort";

// Pure Q14 helpers (F03-T09, ui_ux.md §4.11, anakloud-baseline-questions.md
// Q14). No I/O, no network — the function list, the chip cap, the "answered"
// rule and the stored-value mapping are deterministic so they can be unit-tested
// without a browser and so the shell's forward-navigation decision stays pure
// (the same discipline as the other F03 libs).
//
// Q14 is four parts on one screen: (a) up to three functions the respondent
// wants to own, as chips; (b) one field per teammate naming the function they
// think that teammate owns, names pre-filled from the cohort roster; (c) a real
// hours-a-week number from October 2026, on a slider that starts **unset** — a
// default is an anchor; and (d) the private field, a distinct inset panel whose
// copy is verbatim from ui_ux §4.11(d), optional, and written to its own
// `is_private = true` row (F01-T03) so no comparison or export ever carries it.
//
// The chip-cap rule is the point of (a): at most three, and once three are
// chosen the rest dim — but a dimmed chip is still tapped, and tapping one
// shows "Pick at most 3 — swap one out." rather than silently doing nothing. No
// subset of the sixteen functions may be visually distinguished, reordered or
// emphasised (ui_ux §4.11 / baseline Q14), so the chips render uniformly from
// this list in the registry's stable order.

/** Maximum number of function chips a respondent may select (baseline Q14). */
export const MAX_FUNCTION_CHIPS = 3;

/**
 * The line shown when the respondent taps a dimmed chip after the cap is
 * reached (ui_ux §4.11: "Pick at most 3 — swap one out."). Plain microcopy,
 * not an error: nothing has failed, the tap just can't select a fourth function.
 */
export const FUNCTION_CAP_MESSAGE = "Pick at most 3 — swap one out.";

/**
 * The verbatim copy for Q14(d), the private field (ui_ux §4.11(d)). The panel
 * must state on the field itself that only the facilitator sees it, that it
 * appears in no comparison and no export, and that it is optional — and each
 * line is written word for word from the spec because copy is code (AGENTS.md).
 */
export const PRIVATE_PANEL_HEADING = "Only Paul sees this one.";
export const PRIVATE_PANEL_BODY =
  "Not in any comparison, not in any export, not shown to the group.";
export const PRIVATE_PANEL_PROMPT =
  "Is there anything that would make you step back from this, that you haven't said out loud yet?";
export const PRIVATE_PANEL_OPTIONAL = "leaving this blank is completely fine.";

/**
 * The sixteen functions, in the registry's stable order, keyed by id to the
 * display label. Written verbatim from the baseline Q14 list (product · backend
 * · mobile/frontend · QA · design/UX · data privacy & security · clinical &
 * regulatory liaison · sales & center partnerships · doctor relations ·
 * onboarding & customer success · support · marketing · finance & bookkeeping ·
 * fundraising · legal & IP · hiring) and rendered uniformly — no subset is
 * distinguished, reordered or emphasised.
 */
export const FUNCTION_LABELS: Record<FunctionId, string> = {
  product: "product",
  backend: "backend",
  mobile_web: "mobile/frontend",
  qa: "QA",
  design_ux: "design/UX",
  data_privacy_security: "data privacy & security",
  clinical_relations: "clinical & regulatory liaison",
  sales_partner: "sales & center partnerships",
  doctor_relations: "doctor relations",
  onboarding_success: "onboarding & customer success",
  support: "support",
  marketing: "marketing",
  finance: "finance & bookkeeping",
  fundraising: "fundraising",
  legal_ip: "legal & IP",
  hiring: "hiring",
};

/**
 * Q14 while the respondent is still working. `wants` holds 0–3 function ids;
 * `others` maps each teammate id to the one function the respondent thinks they
 * own, or null until a choice is made (never a defaulted function — that would
 * be an anchor); `hours` is null until the slider is set, so an unset slider
 * reads honestly as unanswered rather than hiding behind a default; and
 * `privateNote` is the optional (d) text.
 */
export interface Q14Draft {
  wants: FunctionId[];
  others: Record<string, FunctionId | null>;
  hours: number | null;
  privateNote: string;
}

/**
 * An empty, unstarted Q14 draft: no functions, every teammate's row null, the
 * hours slider unset (null), and a blank private note. `others` is initialised
 * for exactly the teammates in the roster so no teammate's row is missing.
 */
export function emptyQ14Draft(teammates: readonly CohortMember[]): Q14Draft {
  return {
    wants: [],
    others: Object.fromEntries(teammates.map((t) => [t.id, null])),
    hours: null,
    privateNote: "",
  };
}

/**
 * Whether a Q14 draft counts as an answer (Q14 is required, F03-T09). The gate
 * is the hours slider: (a) is "up to three" and could legitimately be none, (b)
 * is per-teammate and (d) is explicitly optional, but the baseline calls the
 * hours spread "the most important number on this entire form" and the slider
 * starts unset for exactly that reason — so an answered Q14 is one where the
 * respondent has committed to a number of hours. Nothing is defaulted to make
 * this pass.
 */
export function q14IsAnswered(value: Q14Draft): boolean {
  return value.hours !== null;
}

/**
 * The stored §3.1 shape once the draft holds a committed hours value. The
 * caller guarantees a value exists (an answered draft has `hours !== null`), so
 * this maps the four-part draft onto `{ wants, others, hours, private_note }`,
 * dropping the null entries from `others` (an unset teammate row has nothing to
 * store). `private_note` is split to its own `is_private = true` row at
 * persist time by upsertAnswer (F01-T03), not here.
 */
export function toQ14Value(draft: Q14Draft): Q14Value {
  if (draft.hours === null) {
    throw new Error("cannot map an unanswered Q14 draft to a value");
  }
  const others: Record<string, FunctionId> = {};
  for (const [id, fn] of Object.entries(draft.others)) {
    if (fn !== null) others[id] = fn;
  }
  return {
    wants: draft.wants,
    others,
    hours: draft.hours,
    private_note: draft.privateNote,
  };
}

/**
 * The stable function set and question id, so the registry wiring is asserted
 * in one place and the unit test keys on the same arrays the component renders.
 */
export const FUNCTION_ID_LIST: readonly FunctionId[] = FUNCTION_IDS;
export const Q14_ID = Q14_QUESTION_IDS[0];