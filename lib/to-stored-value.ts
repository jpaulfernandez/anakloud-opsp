import type { Q14Draft } from "./q14";
import { toQ14Value } from "./q14";
import type { Q10Draft } from "./q10";
import { modelUnitLabel, parseQ10Amount } from "./q10";
import type { QuestionId } from "./questions";

// Draft → stored-value mapping for autosave (F04-T02, tech_infrastructure.md
// §3.1). Most questions' working drafts are already the §3.1 stored shape, so
// they pass through unchanged and the autosave hook's shape guard decides when
// they are worth persisting. Two composite questions do not: Q10 and Q14 hold
// drafts whose field names and nullable placeholders differ from what the
// PATCH endpoint accepts, so they are transformed here — Q14 through the same
// toQ14Value used at submit time (which also carries the private note the API
// splits to its own row), and Q10 by normalising its typed amount and deriving
// the unit from the chosen model.
//
// When the draft is not far enough along to fill a valid stored shape (Q10
// without a payer, model and amount; Q14 without a committed hours value), the
// function returns null and autosave stands aside — the answer is retained in
// the field, and it will be saved the moment it becomes a storable answer.
// This is pure: no I/O, no network, so it unit-tests exhaustively.

/**
 * The canonical stored-value shape for a working draft, ready to PATCH, or null
 * when the draft cannot currently form one. Identity for every question whose
 * draft already matches §3.1; converted for Q10 and Q14.
 */
export function storableAnswerValue(id: QuestionId, value: unknown): unknown {
  if (id === "q10") return toStorableQ10(value);
  if (id === "q14") return toStorableQ14(value);
  return value;
}

/** Q14: requires a committed hours value (the draft's "answered" gate). */
function toStorableQ14(value: unknown): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("hours" in value) ||
    value.hours === null ||
    value.hours === undefined
  ) {
    return null;
  }
  return toQ14Value(value as Q14Draft);
}

/** Q10: requires a payer (at least one), a model and a parseable peso amount. */
function toStorableQ10(value: unknown): unknown {
  if (!value || typeof value !== "object") return null;
  const draft = value as Q10Draft;
  const payerList = Array.isArray(draft.payer)
    ? draft.payer
    : typeof draft.payer === "string" && draft.payer
      ? [draft.payer]
      : [];
  if (payerList.length === 0 || draft.model === null) return null;
  const payer = Array.isArray(draft.payer)
    ? draft.payer
    : draft.payer !== null
      ? draft.payer
      : payerList;
  const amount = parseQ10Amount(draft.amount);
  if (amount === null) return null;
  return {
    payer,
    model: draft.model,
    amount,
    unit: modelUnitLabel(draft.model),
    first_peso: draft.firstPeso,
  };
}