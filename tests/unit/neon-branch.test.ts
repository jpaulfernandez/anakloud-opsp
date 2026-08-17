import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClientBase } from "../../lib/db";
import {
  assertNotProductionNeon,
  isProductionNeonBranch,
  resolveNeonBranch,
} from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F19-T01 (M04) — the production-branch guard. Pure URL parsing first, then the
// migrate() choke-point assertion. No Postgres: the reject path throws before
// any SQL runs, so it is exercised with a stub client.

const PRODUCTION =
  "postgres://user:pw@ep-deadbeef1234.us-east-2.aws.neon.tech/dbname";
const PRODUCTION_POOLED =
  "postgres://user:pw@ep-deadbeef1234-pooler.us-east-2.aws.neon.tech/dbname?sslmode=require";
const BRANCH =
  "postgres://user:pw@preview-3--ep-deadbeef1234.us-east-2.aws.neon.tech/dbname?sslmode=require";
const BRANCH_POOLED =
  "postgres://user:pw@preview-3--ep-deadbeef1234-pooler.us-east-2.aws.neon.tech/dbname";
const LOCAL = "postgres://user:pw@localhost:5435/alignedb";

describe("resolveNeonBranch", () => {
  it("treats a plain ep- hostname as the default (production) branch", () => {
    expect(resolveNeonBranch(PRODUCTION)).toEqual({ isNeon: true, name: null });
    expect(resolveNeonBranch(PRODUCTION_POOLED)).toEqual({
      isNeon: true,
      name: null,
    });
  });

  it("names the branch from a --ep- hostname, pooled or direct", () => {
    expect(resolveNeonBranch(BRANCH)).toEqual({ isNeon: true, name: "preview-3" });
    expect(resolveNeonBranch(BRANCH_POOLED)).toEqual({
      isNeon: true,
      name: "preview-3",
    });
  });

  it("keeps a used branch name with internal hyphens intact", () => {
    expect(
      resolveNeonBranch(
        "postgres://user:pw@pr-123--ep-a1.us-east-2.aws.neon.tech/db",
      ),
    ).toEqual({ isNeon: true, name: "pr-123" });
  });

  it("flags a non-Neon (local docker) host as not Neon", () => {
    expect(resolveNeonBranch(LOCAL)).toEqual({ isNeon: false, name: null });
  });
});

describe("isProductionNeonBranch", () => {
  it("flags a plain ep- hostname as production", () => {
    expect(isProductionNeonBranch(PRODUCTION)).toBe(true);
    expect(isProductionNeonBranch(PRODUCTION_POOLED)).toBe(true);
  });

  it("allows a named, non-production branch", () => {
    expect(isProductionNeonBranch(BRANCH)).toBe(false);
    expect(isProductionNeonBranch(BRANCH_POOLED)).toBe(false);
  });

  it("is fail-safe for a branch literally named like production", () => {
    expect(
      isProductionNeonBranch(
        "postgres://user:pw@main--ep-a1.us-east-2.aws.neon.tech/db",
      ),
    ).toBe(true);
  });

  it("honours a custom production-branch list", () => {
    expect(
      isProductionNeonBranch(BRANCH, ["preview-3"]),
    ).toBe(true);
    expect(
      isProductionNeonBranch(BRANCH, ["some-other"]),
    ).toBe(false);
  });

  it("never flags a non-Neon (local docker) connection", () => {
    expect(isProductionNeonBranch(LOCAL)).toBe(false);
  });
});

describe("assertNotProductionNeon", () => {
  it("throws on a production branch URL", () => {
    expect(() => assertNotProductionNeon(PRODUCTION)).toThrow(/production Neon branch/i);
    expect(() => assertNotProductionNeon(PRODUCTION_POOLED)).toThrow(
      /production Neon branch/i,
    );
  });

  it("passes through a named non-production branch", () => {
    expect(() => assertNotProductionNeon(BRANCH)).not.toThrow();
    expect(() => assertNotProductionNeon(BRANCH_POOLED)).not.toThrow();
  });

  it("passes through local docker and an absent URL", () => {
    expect(() => assertNotProductionNeon(LOCAL)).not.toThrow();
    expect(() => assertNotProductionNeon(undefined)).not.toThrow();
  });
});

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

function setEnv(values: { DATABASE_URL?: string; DATABASE_URL_UNPOOLED?: string }) {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
}

describe("migrate() production-branch guard (F19-T01)", () => {
  it("refuses before running any SQL when DATABASE_URL is the production branch", async () => {
    setEnv({ DATABASE_URL: PRODUCTION, DATABASE_URL_UNPOOLED: undefined });
    const query = vi.fn(async () => {
      throw new Error("guard did not stop before SQL");
    });
    const db = { query } as unknown as ClientBase;
    await expect(migrate(db)).rejects.toThrow(/production Neon branch/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuses when DATABASE_URL_UNPOOLED is the production branch", async () => {
    setEnv({ DATABASE_URL: BRANCH, DATABASE_URL_UNPOOLED: PRODUCTION });
    const query = vi.fn(async () => {
      throw new Error("guard did not stop before SQL");
    });
    const db = { query } as unknown as ClientBase;
    await expect(migrate(db)).rejects.toThrow(/production Neon branch/i);
    expect(query).not.toHaveBeenCalled();
  });

  it("allows a non-production branch URL through to SQL", async () => {
    setEnv({ DATABASE_URL: BRANCH, DATABASE_URL_UNPOOLED: undefined });
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const db = { query } as unknown as ClientBase;
    // The guard passes; migrate proceeds with its live query flow.
    await expect(migrate(db)).resolves.toBeUndefined();
    expect(query).toHaveBeenCalled();
  });
});