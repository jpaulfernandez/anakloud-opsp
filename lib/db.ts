import { Client } from "pg";
import { logMigrationWarning } from "./log";

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