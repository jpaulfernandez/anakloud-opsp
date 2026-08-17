import type { ClientBase } from "./db";
import { ACCESS_DOWN_SQL, ACCESS_UP_SQL } from "./access-policy";
import {
  OWN_ANSWER_READ_FUNCTION_DROP_SQL,
  OWN_ANSWER_READ_FUNCTION_SQL,
} from "./answers";
import {
  COHORT_LIFECYCLE_DOWN_SQL,
  COHORT_LIFECYCLE_UP_SQL,
} from "./cohort-lifecycle";
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
  {
    version: "0005_ground_rules_acknowledgement",
    // The ground-rules acknowledgement (F02-T05): a timestamp on respondents
    // that records the one-time "Got it" before any question is shown. The
    // gate is presence — null means not yet acknowledged, a value means it has
    // been. It lives on the respondents row so it persists across sessions and
    // devices and survives resumption. Added to the fresh-schema path (0001,
    // generated from SCHEMA) already, so this `if not exists` stays a no-op
    // there, exactly like 0003.
    up: `alter table respondents add column if not exists ground_rules_acknowledged_at timestamptz;`,
    down: `alter table respondents drop column if exists ground_rules_acknowledged_at;`,
  },
  {
    version: "0006_own_answer_read",
    // F04-T01's GET /api/answers must return the caller's own q14d so a
    // respondent can review and edit their own private note. The answers RLS
    // policy (0002) deliberately denies a reader their own is_private row
    // ("deny reads, including the reader's own"). That guarantee stays intact
    // for every other path — exports, PDFs and AI payloads all go through
    // listPublicAnswers, which still filters is_private = false. This one
    // security-definer function, owned by the migration role (a superuser,
    // which bypasses RLS), is the only read that returns private rows, and it
    // is bounded to the current respondent via the same 'app.respondent_id'
    // GUC the policies read, so no one can use it to read another person's
    // note — exactly like the bounded app_upsert_own_answer writer from 0002.
    // The SQL lives in lib/answers.ts so every direct answer-table select stays
    // in that module (the F01-T03 invariant); this migration only applies it.
    up: OWN_ANSWER_READ_FUNCTION_SQL,
    down: OWN_ANSWER_READ_FUNCTION_DROP_SQL,
  },
  {
    version: "0007_cohort_lifecycle",
    // F09-T05 — the one cascading, name-confirmed cohort delete. A
    // security-definer function owned by the migration role so it can delete a
    // cohort's answers despite RLS (a facilitator's RLS grants cohort-wide
    // *read* but only own-row delete). It verifies the acting respondent is
    // the cohort's facilitator and that the request names the cohort
    // correctly, then removes every dependent row in dependency order. The SQL
    // lives in lib/cohort-lifecycle.ts so the backend that calls it and the
    // migration that applies it cannot drift.
    up: COHORT_LIFECYCLE_UP_SQL,
    down: COHORT_LIFECYCLE_DOWN_SQL,
  },
  {
    version: "0008_export_audit",
    // F10-T05 — the re-confirmed private export must "record that the export
    // occurred" (spec.md FR-34 / tech_infrastructure.md §4). This is an audit
    // of the one export that releases Q14(d) private rows to anyone, so it is
    // operational state rather than part of the §3 data model, exactly like
    // the resume-code rate-limit ledger (0004). One row per confirmed
    // private-inclusive export, stamped with the acting facilitator. Default
    // (public-only) exports are not private releases and are not logged.
    up: `create table if not exists export_events (
           id               uuid primary key,
           cohort_id        uuid not null references cohorts (id),
           acted_by         uuid not null references respondents (id),
           included_private boolean not null default true,
           created_at       timestamptz not null default now()
         );
         create index if not exists export_events_cohort_id_idx
           on export_events (cohort_id);`,
    down: `drop table if exists export_events;`,
  },
  {
    version: "0009_budget_warning_alerts",
    // F12-T07 — per-cohort "threshold already fired" flags so the 70% and 90%
    // budget warnings fire once each (spec.md §7.2), never re-warning on every
    // dashboard request. Boolean columns on ai_budget, the same row that
    // already carries circuit state. Added to the fresh-schema path (0001,
    // generated from SCHEMA) already, so this `if not exists` stays a no-op
    // there, exactly like 0003 and 0005.
    up: `alter table ai_budget add column if not exists warn70_fired bool not null default false;
         alter table ai_budget add column if not exists warn90_fired bool not null default false;`,
    down: `alter table ai_budget drop column if exists warn90_fired;
           alter table ai_budget drop column if exists warn70_fired;`,
  },
  {
    version: "0010_analysis_outputs",
    // F14-T06 — durable retention of facilitator-analysis outputs (FR-35). Each
    // serve of POST /api/admin/analyse is recorded as its own row so a re-run
    // never overwrites the previous output: a change in the read stays visible
    // against what came before, across page loads and sessions. The row carries
    // the exact fields FR-35 demands an output be labelled with — the pinned
    // model id used and the generation timestamp — plus the serving level
    // (L0..L3), recorded alongside every output. The whole serve body is kept
    // as `body`, so the panel can re-render exactly what was served. This is
    // facilitator prep material, so both write and read are gated on the
    // cohort facilitator through the same RLS function the other admin tables
    // use; only the cohort's facilitator can add or read a row.
    //
    // Operational history rather than a §3 data-model table, so it ships as a
    // hand-written migration exactly like the export audit (0008) and the
    // resume-code rate-limit ledger (0004).
    up: `create table if not exists analysis_outputs (
           id            uuid primary key,
           cohort_id     uuid not null references cohorts (id),
           scope         text not null,
           question_id   text,
           level         text not null,
           model         text,
           generated_at  timestamptz not null,
           body          jsonb not null
         );
         create index if not exists analysis_outputs_cohort_question_idx
           on analysis_outputs (cohort_id, question_id);
         alter table analysis_outputs enable row level security;
         alter table analysis_outputs force row level security;
         create policy analysis_outputs_facilitator_insert
           on analysis_outputs
           for insert
           with check (app_is_facilitator_of_cohort(cohort_id));
         create policy analysis_outputs_facilitator_read
           on analysis_outputs
           for select
           using (app_is_facilitator_of_cohort(cohort_id));`,
    down: `drop policy if exists analysis_outputs_facilitator_read on analysis_outputs;
           drop policy if exists analysis_outputs_facilitator_insert on analysis_outputs;
           alter table analysis_outputs no force row level security;
           alter table analysis_outputs disable row level security;
           drop table if exists analysis_outputs;`,
  },
  {
    version: "0011_official_opsp_drafts",
    // F15-T01 — the official OPSP canvas's persistence and authoring gate.
    //
    // The official draft is an `opsp_drafts` row with `owner_type = 'official'`
    // and a null owner_id (the team's plan is not any one respondent's), scoped
    // to the cohort. Holds the facilitator-only authoring policies plus a
    // lineage constraint:
    //
    //   * RLS — the baseline 0002 policies only admit drafts_own_* rows where
    //     owner_type = 'individual' and owner_id = the acting respondent, so a
    //     respondent already cannot write an official row (its owner_type fails
    //     every own_* check). RLS policies are permissive (OR'd), so the
    //     facilitator additionally needs their own insert/update/delete to
    //     author official rows for their cohort. The read side is already
    //     covered by 0002's drafts_facilitator_read (it does not filter on
    //     owner_type), so no new select policy is required.
    //
    //   * One lineage per cohort — each edit writes a NEW opsp_drafts version,
    //     so a cohort's official plan is a chain of rows. Version 1 is the root
    //     of that chain, so a partial unique index on (cohort_id) where
    //     owner_type = 'official' and version = 1 admits at most one lineage
    //     per cohort. A later F15 write path cannot create a second official
    //     chain for the same cohort without tripping it.
    up: `create policy drafts_official_insert on opsp_drafts
           for insert
           with check (owner_type = 'official' and owner_id is null
                       and app_is_facilitator_of_cohort(cohort_id));
         create policy drafts_official_update on opsp_drafts
           for update
           using (owner_type = 'official' and owner_id is null
                  and app_is_facilitator_of_cohort(cohort_id))
           with check (owner_type = 'official' and owner_id is null
                       and app_is_facilitator_of_cohort(cohort_id));
         create policy drafts_official_delete on opsp_drafts
           for delete
           using (owner_type = 'official' and owner_id is null
                  and app_is_facilitator_of_cohort(cohort_id));
         create unique index if not exists opsp_drafts_one_official_lineage_idx
           on opsp_drafts (cohort_id)
           where owner_type = 'official' and version = 1;`,
    down: `drop index if exists opsp_drafts_one_official_lineage_idx;
           drop policy if exists drafts_official_delete on opsp_drafts;
           drop policy if exists drafts_official_update on opsp_drafts;
           drop policy if exists drafts_official_insert on opsp_drafts;`,
  },
];

async function withTransaction<T>(
  client: ClientBase,
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
export async function migrate(db: ClientBase): Promise<void> {
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
export async function rollbackMigration(db: ClientBase, version: string): Promise<void> {
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