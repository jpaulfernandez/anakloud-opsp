import { randomUUID } from "node:crypto";
import { createDbClient } from "../lib/db";
import { generateInviteToken } from "../lib/invites";
import { generateResumeCode } from "../lib/resume";
import { SEED_COHORT_ID } from "../lib/seed";

// Script to create a new respondent with an invite token and resume code.
// Usage: npx tsx --env-file-if-exists=.env.local scripts/create-invite.ts "Respondent Name" "email@example.com" [isFacilitator]

async function main() {
  const name = process.argv[2] || "New Team Member";
  const email = process.argv[3] || null;
  const isFacilitator = process.argv[4] === "true" || process.argv[4] === "1";

  const db = createDbClient();
  await db.connect();

  try {
    // Check if cohort exists or get the latest open cohort
    const { rows: cohorts } = await db.query<{ id: string; name: string }>(
      "SELECT id, name FROM cohorts WHERE status = 'open' ORDER BY created_at DESC LIMIT 1"
    );

    const cohortId = cohorts[0]?.id ?? SEED_COHORT_ID;
    const cohortName = cohorts[0]?.name ?? "Anakloud Q4 2026";

    const id = randomUUID();
    const inviteToken = generateInviteToken();
    const resumeCode = generateResumeCode();

    await db.query(
      `INSERT INTO respondents (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, cohortId, name, email, inviteToken, resumeCode, isFacilitator]
    );

    console.log("\n========================================");
    console.log("  Successfully Created New Respondent");
    console.log("========================================");
    console.log(`  Name:           ${name}`);
    console.log(`  Email:          ${email ?? "(none)"}`);
    console.log(`  Cohort:         ${cohortName} (${cohortId})`);
    console.log(`  Role:           ${isFacilitator ? "Facilitator" : "Team Member"}`);
    console.log("----------------------------------------");
    console.log(`  Invite Token:   ${inviteToken}`);
    console.log(`  Claim Link:     /claim?token=${inviteToken}`);
    console.log(`  Resume Code:    ${resumeCode}`);
    console.log("========================================\n");
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Failed to create invite:", err);
  process.exit(1);
});
