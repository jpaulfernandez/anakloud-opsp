import { Client } from "pg";

/**
 * A Postgres client bound to DATABASE_URL. Server-only by construction; never
 * import this module from a client component. Callers are responsible for
 * `connect()`/`end()`.
 */
export function createDbClient(): Client {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to open a database connection");
  }
  return new Client({ connectionString: databaseUrl });
}