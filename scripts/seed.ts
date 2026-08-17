import { createMigrationClient } from "../lib/db";
import { migrate } from "../lib/migrate";
import { seedCohort, SEED_COHORT_ID, SEED_RESPONDENTS } from "../lib/seed";

// `npm run db:seed` — populate one cohort and six conflicting respondents so
// the admin comparison and divergence scoring can be developed without real
// humans. Idempotent: re-running upserts the same fixture instead of adding a
// second cohort. Run it with the same privileged role the migrations use.
//
// Runs through the migration (direct) endpoint: seeding runs migrations, and
// migrate() relies on a session-scoped advisory lock that is unreliable
// through Neon's pooled (PgBouncer) endpoint.
//
// The fixture data (names, emails, invite tokens) is deliberately fake; nothing
// here is read into logs beyond the counts below — answer text never prints.

async function main(): Promise<void> {
  const db = createMigrationClient();
  try {
    await db.connect();
    // Seeds are a developer convenience on a schema the migrations manage; a
    // fresh local database has no tables yet, so apply them if missing.
    await migrate(db);
    await seedCohort(db);

    const respondentCount = SEED_RESPONDENTS.length;
    const facilitatorCount = SEED_RESPONDENTS.filter((r) => r.is_facilitator).length;
    console.log(
      `Seeded cohort ${SEED_COHORT_ID} (Anakloud Q4 2026) with ` +
        `${respondentCount} respondents (${facilitatorCount} facilitator). ` +
        "Idempotent: run again to re-upsert the same six rows.",
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("db:seed failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});