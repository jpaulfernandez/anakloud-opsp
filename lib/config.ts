// Boot-time configuration (F01-T01). Server-only by construction: importing
// this module from a client component would fail the "AI key stays server-side"
// rule, so it is only ever imported from server code paths.

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

export interface BootConfig {
  env: string;
  values: Record<ConfigEnvName, string | undefined>;
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
    // product must run deterministic-only. Nothing above debug may surface it.
    console.debug(
      "[config] ANTHROPIC_API_KEY is not set; running deterministic-only.",
    );
  }

  return { env: process.env.NODE_ENV ?? "development", values };
}