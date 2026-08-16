// Which served levels run the coach (F05-T06, spec.md §7, PR6, ui_ux.md D3).
//
// Client-safe by construction: it imports only the `ResolvedLevel` type, which
// is erased at build, so nothing from the server-only `config.ts` module value
// graph reaches a client bundle.

import type { ResolvedLevel } from "./config";

export type { ResolvedLevel } from "./config";

/**
 * Whether the deterministic coach runs at the served level. Only L3 — the
 * plain-form mode — disables it: there every answer is accepted without
 * evaluation and no coach card may render (spec.md §7 "None. Every answer
 * accepted"). Every other level, including `auto`, keeps the deterministic
 * sibling so a failing validator still produces a nudge.
 */
export function coachActiveAtLevel(level: ResolvedLevel): boolean {
  return level !== "L3";
}