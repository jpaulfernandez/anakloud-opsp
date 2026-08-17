import { Client } from "@neondatabase/serverless";
import { logMigrationWarning } from "./log";

// F17-T02: this module is the only place a database driver is constructed and,
// value or type, the only application module that mentions the driver package.
// The rest of lib/ and app/ reaches the database exclusively through
// `createDbClient()` and through the `ClientBase` queryable type re-exported
// here, so swapping the transport (now the Neon serverless driver; formerly
// `pg`) never touches a call site.
export type { ClientBase, Client } from "@neondatabase/serverless";

/**
 * Neon's pooled and direct endpoints reject plaintext, so both connection
 * strings must carry `sslmode=require`. Local and CI still run a docker
 * Postgres that speaks no TLS, so a non-Neon host is passed through unchanged.
 * The function is idempotent: an explicit safe sslmode is left alone.
 */
export function requireNeonSsl(connectionString: string): string {
  const url = new URL(connectionString);
  if (!url.hostname.endsWith(".neon.tech")) return connectionString;

  const mode = url.searchParams.get("sslmode");
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
    return connectionString;
  }
  url.searchParams.set("sslmode", "require");
  url.search = url.searchParams.toString();
  return url.toString();
}

/**
 * The Neon branch a connection string targets (F19-T01, M04). Neon gives every
 * branch its own compute endpoint, so a connection string carries the branch in
 * its hostname, not in a query parameter:
 *
 *   ep-deadbeef1234.us-east-2.aws.neon.tech              default (main) branch
 *   preview-3--ep-deadbeef1234.us-east-2.aws.neon.tech   a branch named
 *                                                       "preview-3" (pooled or
 *                                                       direct, `-pooler` or not)
 *
 * The default branch is the one the production app serves, and it is exactly
 * the case a plain `ep-…` hostname denotes. A `--ep-` hostname names its
 * branch. Local Docker speaks a non-Neon host, which is distinct from both.
 */
export interface NeonBranch {
  /** Whether the hostname is a Neon compute endpoint. `false` for local. */
  isNeon: boolean;
  /** The named branch, or `null` for the default (main) branch. */
  name: string | null;
}

/** Parse which Neon branch a connection string targets. */
export function resolveNeonBranch(connectionString: string): NeonBranch {
  const url = new URL(connectionString);
  const host = url.hostname;
  if (!host.endsWith(".neon.tech")) return { isNeon: false, name: null };
  const firstLabel = host.split(".")[0];
  const named = /^(.*)--ep-/.exec(firstLabel);
  if (named && named[1]) return { isNeon: true, name: named[1] };
  return { isNeon: true, name: null };
}

/**
 * The Neon branch names that are treated as production. Neon's default branch
 * (`main`) is the default; an operator who renames it can extend this.
 */
export const PRODUCTION_NEON_BRANCHES: ReadonlyArray<string> = ["main"];

/**
 * True when a connection string resolves to the production Neon branch. A plain
 * `ep-…` hostname is the production branch (fail-safe), a `--ep-` hostname is
 * only production if it names a production branch, and a non-Neon host (local
 * Docker) is never production.
 */
export function isProductionNeonBranch(
  connectionString: string,
  productionBranches: ReadonlyArray<string> = PRODUCTION_NEON_BRANCHES,
): boolean {
  const { isNeon, name } = resolveNeonBranch(connectionString);
  if (!isNeon) return false;
  if (name === null) return true;
  return productionBranches.includes(name);
}

/**
 * F19-T01 production-branch guard. Throws when a connection string resolves to
 * the production Neon branch, so the E2E suite and any migration path stops
 * before applying migrations or test data. Absent (`undefined`) or non-Neon
 * (local Docker) strings pass through unchanged — the offline fallback needs no
 * code change.
 */
export function assertNotProductionNeon(connectionString: string | undefined): void {
  if (connectionString === undefined) return;
  if (!isProductionNeonBranch(connectionString)) return;
  throw new Error(
    "Refusing to prepare the database against the production Neon branch. " +
      "Point DATABASE_URL (and DATABASE_URL_UNPOOLED for migrations) at an " +
      "ephemeral Neon branch — a hostname carrying a `--<branch>--ep-` prefix — " +
      "or at local Docker before migrating or seeding test data.",
  );
}

/**
 * A Postgres client bound to `DATABASE_URL` for request-path connections (the
 * Neon pooled endpoint). Server-only by construction; never import this module
 * from a client component. Callers are responsible for `connect()`/`end()`.
 */
export function createDbClient(): Client {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to open a database connection");
  }
  return new Client({ connectionString: requireNeonSsl(databaseUrl) });
}

/**
 * Resolve the connection string the migration command must use. Migrations
 * take the Neon direct (`DATABASE_URL_UNPOOLED`) endpoint because the advisory
 * lock is session-scoped and cannot safely span transactions through a
 * transaction pooler. Request traffic is unaffected. Falls back to
 * `DATABASE_URL` with a warning when unset, so `npm run db:seed` still works
 * in local development.
 */
export function resolveMigrationUrl(): string {
  const unpooled = process.env.DATABASE_URL_UNPOOLED;
  if (unpooled) return unpooled;

  const fallback = process.env.DATABASE_URL;
  if (!fallback) {
    throw new Error("DATABASE_URL is required to resolve the migration connection");
  }
  logMigrationWarning();
  return fallback;
}

/**
 * A Postgres client bound to the migration endpoint (`DATABASE_URL_UNPOOLED`,
 * falling back to `DATABASE_URL`). Used by `npm run db:seed` and any other
 * privileged migration command, never by request-path code.
 */
export function createMigrationClient(): Client {
  return new Client({
    connectionString: requireNeonSsl(resolveMigrationUrl()),
  });
}