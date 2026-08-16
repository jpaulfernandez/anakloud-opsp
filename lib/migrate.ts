import type { Client } from "pg";
import { renderDownSql, renderUpSql, SCHEMA } from "./schema";

export interface Migration {
  version: string;
  up: string;
  down: string;
}

/**
 * The full list of migrations, applied in order. Each pair is generated from
 * SCHEMA, so the up SQL always matches the schema under test and every
 * migration has a reversible down. F01-T02 ships a single migration that
 * creates the whole core schema; later features append their own.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: "0001_core_schema",
    up: renderUpSql(SCHEMA),
    down: renderDownSql(SCHEMA),
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
 */
export async function migrate(db: Client): Promise<void> {
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