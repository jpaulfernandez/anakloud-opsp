import type { Client } from "pg";
import { ACCESS_DOWN_SQL, ACCESS_UP_SQL } from "./access-policy";
import { renderDownSql, renderUpSql, SCHEMA } from "./schema";

export interface Migration {
  version: string;
  up: string;
  down: string;
}

/**
 * The full list of migrations, applied in order. 0001 is generated from
 * SCHEMA so the up SQL always matches the schema under test; 0002 is hand
 * written because row-level security is a policy, not a table shape. 0003
 * adds the invite-revocation column on top of the already-applied 0001, so it
 * is added defensively (`if not exists`) to stay a no-op on the fresh-schema
 * path where 0001 already carries the column. Every migration has a reversible
 * down. Later features append their own.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: "0001_core_schema",
    up: renderUpSql(SCHEMA),
    down: renderDownSql(SCHEMA),
  },
  {
    version: "0002_access_policy",
    up: ACCESS_UP_SQL,
    down: ACCESS_DOWN_SQL,
  },
  {
    version: "0003_invite_revocation",
    up: `alter table respondents add column if not exists invite_revoked_at timestamptz;`,
    down: `alter table respondents drop column if exists invite_revoked_at;`,
  },
  {
    version: "0004_resume_code_attempts",
    // The rate-limit ledger for resume-code claim attempts (F02-T03). One row
    // per attempt, keyed by IP; the rolling-hour check reads recent rows off
    // the (ip, attempted_at) index and inserts the current attempt. This table
    // is operational state, not part of the §3 data model, so it ships as a
    // hand-written migration like 0002 and 0003 rather than living in SCHEMA.
    up: `create table if not exists resume_code_attempts (
           ip           text not null,
           attempted_at timestamptz not null default now()
         );
         create index if not exists resume_code_attempts_ip_time_idx
           on resume_code_attempts (ip, attempted_at);`,
    down: `drop table if exists resume_code_attempts;`,
  },
];

async function withTransaction<T>(
  client: Client,
  run: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    const result = await run();
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

/**
 * Apply every migration whose version is not yet recorded in
 * `schema_migrations`. Idempotent: a second run is a no-op.
 *
 * Multiple concurrent callers (parallel Playwright workers) may target the same
 * schema at once, and Postgres's `create table if not exists schema_migrations`
 * is not atomic against a simultaneous fire, so this serializes them with a
 * session-scoped advisory lock. The lock survives the inner per-migration
 * transactions because advisory locks are held by the session, not the
 * transaction.
 */
export async function migrate(db: Client): Promise<void> {
  await db.query("select pg_advisory_lock(hashtext('align_migrations'))");
  try {
    await db.query(`
      create table if not exists schema_migrations (
        version    text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    for (const migration of MIGRATIONS) {
      const existing = await db.query(
        "select 1 from schema_migrations where version = $1",
        [migration.version],
      );
      if (existing.rowCount && existing.rowCount > 0) continue;

      await withTransaction(db, async () => {
        await db.query(migration.up);
        await db.query("insert into schema_migrations (version) values ($1)", [
          migration.version,
        ]);
      });
    }
  } finally {
    await db.query("select pg_advisory_unlock(hashtext('align_migrations'))");
  }
}

/**
 * Reverse a single migration: run its down SQL and remove the version record.
 */
export async function rollbackMigration(db: Client, version: string): Promise<void> {
  const migration = MIGRATIONS.find((m) => m.version === version);
  if (!migration) throw new Error(`unknown migration: ${version}`);

  const existing = await db.query(
    "select 1 from schema_migrations where version = $1",
    [version],
  );
  if (!existing.rowCount) throw new Error(`migration not applied: ${version}`);

  await withTransaction(db, async () => {
    await db.query(migration.down);
    await db.query("delete from schema_migrations where version = $1", [version]);
  });
}