// The coach output guard (F13-T03, tech_infrastructure.md §5.4). Pure
// functions, no I/O, no network.
//
// A prompt is a request, not a guarantee. This is the enforcement that runs on
// every coach response before it reaches a browser. It does the four §5.4
// checks — banned terms on `hint` and `example`, `hint` ≤25 words, no digit in
// `hint`, and the verdict-sanity rule (an "ok" verdict carries an empty hint) —
// on the structured coach output, reusing the shared containment engine from
// lib/coach-containment.ts so offline (T1), live (scripts/coach-containment.ts)
// and this runtime guard can never drift apart.
//
// The gateway runs this in its guard stage. A trip discards the model output
// and serves the deterministic sibling; the gateway logs the reason as a guard
// trip and never retries (§5.4: a tripped guard means the prompt is leaking and
// should surface in the log, not be papered over). The static hint for the
// question is served by the caller on an L2 result, exactly as any ordinary L2
// degrade is — so the respondent sees a normal coach card either way.

import type { CoachOutput } from "./coach-prompt";
import { parseCoachResponse } from "./coach-prompt";
import { coachOutputViolations, hintViolations } from "./coach-containment";

/**
 * The outcome of running the §5.4 guard on one coach response. `pass` carries
 * the output the model produced; `trip` carries the list of violated checks,
 * which the gateway records as the `guard_tripped` reason (§11 trip metric).
 */
export type CoachGuardResult =
  | { kind: "pass"; output: CoachOutput }
  | { kind: "trip"; violations: string[] };

/**
 * Run the §5.4 guard over one already-parsed coach output. Pure — the checks
 * are exactly those in `coachOutputViolations`, so a trip here is defined the
 * same way as a trip in the offline and live T1 harnesses.
 */
export function guardCoachOutput(output: CoachOutput): CoachGuardResult {
  const violations = coachOutputViolations({
    verdict: output.verdict,
    hint: output.hint,
    example: output.example,
  });
  if (violations.length === 0) {
    return { kind: "pass", output };
  }
  return { kind: "trip", violations };
}

/**
 * Run the §5.4 guard over a coach response's serialized text.
 *
 * Real coach responses are the structured-output JSON from §5.3 (the provider
 * serialises the forced `coach_result` tool input back to text), so this parses
 * them and guards the structured fields — including the separate example scan
 * and the verdict-sanity rule. A response that does not parse as a valid
 * structured coach output is itself unservable as §5.3 output, so it is fallen
 * back to the raw hint scan rather than let an unparseable response past.
 */
export function guardCoachResponse(text: string): CoachGuardResult {
  try {
    return guardCoachOutput(parseCoachResponse(text));
  } catch {
    const violations = hintViolations(text);
    if (violations.length === 0) {
      // Not structured, but nothing in the raw text trips the hint checks — let
      // the gateway decide from here as it always has. The fabricated output is
      // never served; the gateway returns the raw provider text on a pass.
      return {
        kind: "pass",
        output: { verdict: "needs_work", dimension: null, hint: text, example: "" },
      };
    }
    return { kind: "trip", violations };
  }
}