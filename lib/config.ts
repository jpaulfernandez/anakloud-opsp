// Boot-time configuration and AI level pinning (F01-T01, F01-T06). Server-only
// by construction: importing this module from a client component would fail the
// "AI key stays server-side" rule, so it is only ever imported from server code
// paths.
import { bootDebug } from "./log";

export const CONFIG_ENV_NAMES = [
  "DATABASE_URL",
  "ANTHROPIC_API_KEY",
  "AI_MODEL",
  "AI_LEVEL_PIN",
  "SESSION_SECRET",
  "RESEND_API_KEY",
] as const;

export type ConfigEnvName = (typeof CONFIG_ENV_NAMES)[number];

/**
 * Every env name the application reads at boot. Names with no natural default
 * are always present; the others are optional.
 */
export const OPTIONAL_CONFIG_ENV: ReadonlySet<ConfigEnvName> = new Set([
  "ANTHROPIC_API_KEY",
  "AI_LEVEL_PIN",
  "RESEND_API_KEY",
]);

/**
 * The named deployment environments (tech_infrastructure.md §10). `preview` is
 * distinct from `production` because a per-PR branch must never be billed at
 * L0, so it pins to L2 like local dev.
 */
export type AppEnvironment = "local" | "preview" | "production";

export const APP_ENVIRONMENTS: ReadonlyArray<AppEnvironment> = [
  "local",
  "preview",
  "production",
];

/**
 * Optional override for the deployment environment. `NODE_ENV` only knows
 * development/test/production and cannot tell a preview branch apart from the
 * real cohort, so deployments that want the L2 pin (never bill a preview) set
 * `APP_ENV=preview` explicitly.
 */
export const APP_ENV_VAR = "APP_ENV";

/**
 * The four degradation levels (spec.md §7), plus `auto` for the real production
 * cohort, where the runtime selects the level from health, budget and circuit
 * state rather than a static boot-time pin.
 */
export type AiLevel = "L0" | "L1" | "L2" | "L3";
export type ResolvedLevel = AiLevel | "auto";

export const AI_LEVELS: ReadonlyArray<AiLevel> = ["L0", "L1", "L2", "L3"];

/** Resolve the named environment from an optional override and NODE_ENV. */
export function resolveAppEnvironment(
  appEnv: string | undefined,
  nodeEnv: string | undefined,
): AppEnvironment {
  if (
    appEnv === "local" ||
    appEnv === "preview" ||
    appEnv === "production"
  ) {
    return appEnv;
  }
  return nodeEnv === "production" ? "production" : "local";
}

/**
 * Resolve the effective AI level pin from the environment default and any
 * explicit `AI_LEVEL_PIN`. An explicit pin always wins; an invalid explicit pin
 * is a configuration bug and fails loudly rather than being silently ignored.
 */
export function resolveAiLevelPin(
  env: AppEnvironment,
  envPin: string | undefined,
): ResolvedLevel {
  if (envPin !== undefined) {
    if (!AI_LEVELS.includes(envPin as AiLevel)) {
      throw new Error(
        `AI_LEVEL_PIN "${envPin}" is not a valid level; expected one of ${AI_LEVELS.join(", ")}.`,
      );
    }
    return envPin as AiLevel;
  }
  if (env === "local" || env === "preview") {
    return "L2";
  }
  return "auto";
}

/**
 * Alias tokens that are never a pinned model id. `AI_MODEL` must be pinned
 * explicitly because a silently changing model alters coach behaviour
 * mid-cohort and invalidates the contamination audit (tech_infrastructure §10).
 */
export const AI_MODEL_ALIAS_PATTERN =
  /^(latest|newest|best|fastest|cheapest|big|small|fast|cheap|smartest|default)$/i;

export function isModelAlias(model: string): boolean {
  return AI_MODEL_ALIAS_PATTERN.test(model);
}

/**
 * The level actually served. L0 and L1 both require the provider, so when the
 * resolved pin is L0 or L1 but no `AI_MODEL` is configured there is nothing to
 * call: degrade to L2 (rule-based) rather than fail or silently hit the
 * provider with the wrong model.
 */
export function effectiveAiLevel(
  resolved: ResolvedLevel,
  aiModel: string | undefined,
): ResolvedLevel {
  if ((resolved === "L0" || resolved === "L1") && aiModel === undefined) {
    return "L2";
  }
  return resolved;
}

export interface BootConfig {
  /** Named deployment environment, defaults to `local` for development. */
  env: AppEnvironment;
  /** The six bootstrap variables, exactly as named in §10. */
  values: Record<ConfigEnvName, string | undefined>;
  /** The pin after environment defaults are applied; `auto` in production. */
  aiLevelPin: ResolvedLevel;
  /** The pin after the L0/L1-without-model drop. */
  aiLevel: ResolvedLevel;
}

export function loadConfig(): BootConfig {
  const values = {
    DATABASE_URL: process.env.DATABASE_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    AI_MODEL: process.env.AI_MODEL,
    AI_LEVEL_PIN: process.env.AI_LEVEL_PIN,
    SESSION_SECRET: process.env.SESSION_SECRET,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  } as const;

  if (values.ANTHROPIC_API_KEY === undefined) {
    // An unset key is the normal degraded state (PR3), not an error: the whole
    // product must run deterministic-only. Nothing above debug may surface it;
    // every log sink is behind lib/log.ts (F11-T06).
    bootDebug("[config] ANTHROPIC_API_KEY is not set; running deterministic-only.");
  }

  const env = resolveAppEnvironment(
    process.env[APP_ENV_VAR],
    process.env.NODE_ENV,
  );

  const aiModel = values.AI_MODEL;
  if (aiModel !== undefined && isModelAlias(aiModel)) {
    // Reject aliases hard rather than accept a model that silently moves.
    throw new Error(
      `AI_MODEL "${aiModel}" is an alias; pin an explicit model id.`,
    );
  }

  const aiLevelPin = resolveAiLevelPin(env, values.AI_LEVEL_PIN);
  const aiLevel = effectiveAiLevel(aiLevelPin, aiModel);

  return { env, values, aiLevelPin, aiLevel };
}