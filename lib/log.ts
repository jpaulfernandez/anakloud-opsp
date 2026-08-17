// The single sanctioned application-logging sink (F11-T06, spec.md §8,
// tech_infrastructure.md §9, §11).
//
// Everything the running app writes to a log sink goes through this module and
// nowhere else. The guard is two-sided:
//   - `logAICall` accepts exactly the five fields §11 permits — purpose, level
//     served, latency, token counts, guard result — and nothing else. There is
//     deliberately no free-form message parameter, so answer text, invite
//     tokens, resume codes, session cookie values, names and ids cannot be
//     handed to the logger; there is nowhere to put them.
//   - a redaction test greps the whole of `lib/` and `app/` and forbids any
//     `console.` call outside this file. If a future module needs to log, it
//     must come here, where the field whitelist holds.
//
// §11 adds "Never the answer text." These two properties are that rule in
// code: the only payload a runtime log can carry is the five-field record
// below.

/** The four §11 purposes an AI call can have. */
export type AICallPurpose = "coach" | "analysis" | "synthesis";

/** The degradation level that actually served a call (spec.md §7). */
export type AICallLevel = "L0" | "L1" | "L2";

/**
 * Exactly the payload an AI-call log record may carry. The field set is the
 * whole interface: nothing named `hint`, `text`, `message` or `content` exists,
 * so leaking answer substance would require first inventing a field — which the
 * redaction test's wire-shape assertion would reject.
 */
export interface AICallLogRecord {
  purpose: AICallPurpose;
  /** The level that served the request, not the level that was requested. */
  level: AICallLevel;
  /** Wall-clock latency in milliseconds. */
  latencyMs: number;
  /** Token counts in both directions; the per-call budget §7.2 caps. */
  tokens: { input: number; output: number };
  /**
   * The output-guard outcome: the guard name or `"ok"` for a clean pass, null
   * when the guard was not applied. A non-ok value is the §11 trip metric.
   */
  guardResult: string | null;
}

/** The JSON field names on the wire, kept for the redaction-test assertion. */
export const AI_LOG_FIELDS: readonly (keyof AICallLogRecord)[] = [
  "purpose",
  "level",
  "latencyMs",
  "tokens",
  "guardResult",
];

/**
 * Log one AI call as a single structured line carrying the five §11 fields and
 * nothing else. The caller already knows the purpose, the level it served, the
 * latency, the token counts, and the guard result; this module merely frames
 * them. It never inspects or receives any answer content.
 */
export function logAICall(record: AICallLogRecord): void {
  console.log(JSON.stringify(record));
}

/**
 * Boot-time diagnostic reporting (a fixed literal, never content). Kept here
 * so the "only `lib/log.ts` may touch a console sink" property is not broken
 * by configuration wiring. Callers pass only a constant message string.
 */
export function bootDebug(message: string): void {
  console.debug(message);
}

/**
 * Diagnostic warning for a misconfigured migration environment (a fixed
 * literal, never content). Emitted when `DATABASE_URL_UNPOOLED` is absent, so
 * migrations fall back to the pooled `DATABASE_URL`, where the session-scoped
 * advisory lock protecting concurrent runs is unreliable.
 */
export function logMigrationWarning(): void {
  console.warn(
    "DATABASE_URL_UNPOOLED is not set; falling back to DATABASE_URL for " +
      "migrations. pg_advisory_lock is session-scoped, so through a Neon " +
      "pooled (PgBouncer) endpoint the lock and its release can land on " +
      "different backends and concurrent migration runs may not serialise. " +
      "Set DATABASE_URL_UNPOOLED to the Neon direct endpoint before deploying.",
  );
}