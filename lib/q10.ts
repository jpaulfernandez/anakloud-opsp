import {
  Q10_MODEL_OPTIONS,
  Q10_NOT_SURE_MODEL,
  Q10_PAYER_OPTIONS,
  type Q10ModelOption,
  type Q10PayerOption,
} from "./questions";

export type { Q10ModelOption, Q10PayerOption };

// Pure Q10 helpers (F03-T10, anakloud-baseline-questions.md Q10,
// tech_infrastructure.md §3.1). No I/O, no network — the option lists, the
// model-derived unit, and the "answered" rule are deterministic so they can be
// unit-tested without a browser and so the shell's forward-navigation decision
// stays pure (the same discipline as the other F03 libs).
//
// Q10 is four parts: (a) who physically pays, a single choice; (b) the model,
// a single choice; (c) what they pay, a peso amount whose unit follows from the
// model chosen in (b); and (d) the month the first real peso arrives. The unit
// in (c) is the one place a suggested unit is allowed, and only because it is
// *derived* from the respondent's own model choice — it supplies nothing they
// haven't already said. That is the contrast with Q3 (F03-T04), where a unit
// list would be the anchor the question exists to avoid.
//
// "not sure yet" on (b) is a complete and valid answer to Q10(b) (F03-T10,
// spec.md §7.1 Q10). Selecting it must not penalise the respondent: the "what
// they pay" and "first peso month" parts are unknowable to someone who hasn't
// settled the model, so an answered draft with "not sure yet" needs no amount
// and no month. Nothing is invented to make that pass.

/**
 * Whether a model choice is the "not sure yet" escape hatch. Everything that
 * must not penalise "not sure yet" keys off this single check so the special
 * case lives in one place (an answered Q10 draft and any future validation).
 */
export function isNotSureModel(model: string): boolean {
  return model === Q10_NOT_SURE_MODEL;
}

/**
 * The unit label shown beside the Q10(c) amount, derived from the model the
 * respondent already chose in (b). Each model's unit restates its own rate
 * basis — per center, per seat, per child, per session, per upgrade, per
 * referral, or a grant — so the amount field reads as "how much, per what".
 * "not sure yet" supplies no unit because there is no amount to charge yet.
 */
export function modelUnitLabel(model: Q10ModelOption): string {
  switch (model) {
    case "monthly subscription per center":
      return "per center per month";
    case "per-seat/per-therapist":
      return "per seat (a therapist)";
    case "per active child per month":
      return "per active child per month";
    case "per session fee":
      return "per session";
    case "freemium with parent upgrade":
      return "per parent upgrade";
    case "commission on referrals":
      return "per referral";
    case "grant or institutional funding":
      return "grant amount";
    case "not sure yet":
      return "";
  }
}

/**
 * Q10 while the respondent is still working. `payer` and `model` are null until
 * one of their options is selected, so an unstarted question reads as
 * unanswered rather than defaulting to a first option (a default is an anchor);
 * `amount` is the raw string the respondent typed, empty until there is one;
 * and `firstPeso` is the chosen YYYY-MM month, empty until picked. The unit for
 * (c) is not held here — it is derived from `model` at read time via
 * `modelUnitLabel`, so it can never disagree with the model on screen.
 */
export interface Q10Draft {
  payer: Q10PayerOption[] | Q10PayerOption | null;
  model: Q10ModelOption | null;
  amount: string;
  firstPeso: string; // YYYY-MM
}

/** The raw peso amount stripped of thousands separators, or null when blank. */
export function parseQ10Amount(raw: string): number | null {
  const stripped = raw.replace(/,/g, "").trim();
  if (stripped === "") return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

/**
 * Whether a Q10 draft counts as an answer (Q10 is required, F03-T10). At least
 * one payer and the model are always required; beyond that, the answer is
 * complete either when the model is "not sure yet" (the amount and month are
 * unknowable and must not be demanded) or when the respondent has committed an
 * amount and the first-peso month. Requiring a fabricated number from someone
 * who is honestly not sure would be exactly the kind of manufactured confidence
 * the baseline exists to avoid.
 */
export function q10IsAnswered(value: Q10Draft): boolean {
  const payers = Array.isArray(value.payer)
    ? value.payer
    : value.payer !== null
      ? [value.payer]
      : [];
  if (payers.length === 0 || value.model === null) return false;
  if (isNotSureModel(value.model)) return true;
  return parseQ10Amount(value.amount) !== null && value.firstPeso.trim() !== "";
}

/** The seven payer options and eight model options, in registry order. */
export const Q10_PAYER_ID_LIST: readonly Q10PayerOption[] = Q10_PAYER_OPTIONS;
export const Q10_MODEL_ID_LIST: readonly Q10ModelOption[] = Q10_MODEL_OPTIONS;