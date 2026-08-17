import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import {
  createDbClient,
  createMigrationClient,
  requireNeonSsl,
  resolveMigrationUrl,
} from "../../lib/db";

// F17-T01 pure unit tests for the pooled/direct connection-string handling.
// No Postgres; just environment resolution and URL shaping.

const POOLED = "postgres://user:pw@ep-1-pooler.us-east-1.aws.neon.tech/dbname";
const DIRECT = "postgres://user:pw@ep-2.us-east-1.aws.neon.tech/dbname";
const LOCAL = "postgres://user:pw@localhost:5435/alignedb";

interface ConnectionParameters {
  host: string;
  ssl?: unknown;
}

// `connectionParameters` is not part of the public @types/pg type, so read it
// through a minimal shape (it is a real, stable property on the pg Client).
function params(client: Client): ConnectionParameters {
  return (client as unknown as { connectionParameters: ConnectionParameters })
    .connectionParameters;
}

const ENV_KEYS = ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const;
const saved = new Map<string, string | undefined>();

afterEach(() => {
  for (const key of saved.keys()) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

// Assigning `undefined` to a Node env var coerces to the string "undefined", so
// an absent variable must be deleted, not assigned.
function setEnv(values: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

describe("migration URL resolution (F17-T01)", () => {
  it("prefers DATABASE_URL_UNPOOLED over DATABASE_URL", () => {
    setEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMigrationUrl()).toBe(DIRECT);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back to DATABASE_URL and warns about advisory locking", () => {
    setEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: undefined });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(resolveMigrationUrl()).toBe(POOLED);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message.toLowerCase()).toContain("advisory");
    expect(message.toLowerCase()).toContain("pooled");
  });

  it("throws when neither variable is set", () => {
    setEnv({ DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => resolveMigrationUrl()).toThrow(/DATABASE_URL/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("createMigrationClient binds to the unpooled (direct) endpoint when present", () => {
    setEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: DIRECT });
    const client = createMigrationClient();
    expect(params(client).host).toBe("ep-2.us-east-1.aws.neon.tech");
  });

  it("createMigrationClient falls back to DATABASE_URL and warns", () => {
    setEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: undefined });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const client = createMigrationClient();
    expect(params(client).host).toBe("ep-1-pooler.us-east-1.aws.neon.tech");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("request-path connection (F17-T01)", () => {
  it("createDbClient reads DATABASE_URL, not the migration URL", () => {
    setEnv({ DATABASE_URL: LOCAL, DATABASE_URL_UNPOOLED: DIRECT });
    const client = createDbClient();
    expect(params(client).host).toBe("localhost");
  });

  it("createDbClient applies Neon SSL to a Neon request URL", () => {
    setEnv({ DATABASE_URL: POOLED, DATABASE_URL_UNPOOLED: undefined });
    const client = createDbClient();
    expect(params(client).host).toBe("ep-1-pooler.us-east-1.aws.neon.tech");
    expect(params(client).ssl).toBeTruthy();
  });

  it("createDbClient throws when DATABASE_URL is missing", () => {
    setEnv({ DATABASE_URL: undefined, DATABASE_URL_UNPOOLED: undefined });
    expect(() => createDbClient()).toThrow(/DATABASE_URL/);
  });
});

describe("Neon TLS requirement", () => {
  it("forces sslmode=require on a Neon pooled URL", () => {
    expect(requireNeonSsl(POOLED)).toBe(`${POOLED}?sslmode=require`);
  });

  it("forces sslmode=require on a Neon direct URL", () => {
    expect(requireNeonSsl(DIRECT)).toBe(`${DIRECT}?sslmode=require`);
  });

  it("preserves an existing required sslmode", () => {
    expect(requireNeonSsl(`${POOLED}?sslmode=require`)).toBe(`${POOLED}?sslmode=require`);
  });

  it("preserves an explicit safe sslmode", () => {
    expect(requireNeonSsl(`${POOLED}?sslmode=verify-full`)).toBe(
      `${POOLED}?sslmode=verify-full`,
    );
  });

  it("keeps existing query params and appends sslmode", () => {
    expect(requireNeonSsl(`${POOLED}?application_name=align`)).toBe(
      `${POOLED}?application_name=align&sslmode=require`,
    );
  });

  it("leaves a non-Neon (local docker) connection string untouched", () => {
    setEnv({ DATABASE_URL: LOCAL, DATABASE_URL_UNPOOLED: undefined });
    expect(requireNeonSsl(LOCAL)).toBe(`${LOCAL}`);
  });
});