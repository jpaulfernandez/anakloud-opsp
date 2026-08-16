import { randomBytes } from "node:crypto";
import type { ClientBase } from "pg";

// Invite token lifecycle (F02-T01, FR-1, FR-3, tech_infrastructure.md §9).
//
// The invite link is the credential — there is no password. A token is 32
// random bytes encoded base64url, and it is scoped by living on exactly one
// respondents row (the schema enforces uniqueness on invite_token), whose
// cohort_id ties that single respondent to exactly one cohort. Revocation
// marks the row so a presented token stops resolving.
//
// Token validation collapses "does not exist", "revoked" and "belongs to a
// closed cohort" into a single `null` result. The claim path can therefore
// only branch on valid vs invalid, so it shows one neutral screen for all
// three without ever disclosing which applied. The three cases are told apart
// only inside the WHERE clause below, never surfaced to a caller.
//
// No function in this module writes a token to a log sink — a unit test greps
// the source for any logging call and must find none. The token exists only as
// a function result and a database value, never as a log argument.

export const INVITE_TOKEN_BYTES = 32;

/** A fresh, unguessable invite token: 32 random bytes, encoded base64url. */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** What a valid invite token resolves to — exactly one cohort and respondent. */
export interface ResolvedInvite {
  respondentId: string;
  cohortId: string;
  isFacilitator: boolean;
}

/**
 * Resolve an invite token to its respondent, or return null. `null` covers an
 * unknown token, a revoked token, and a token whose cohort is not open — an
 * identical, reason-free outcome by design. The cohort join is how a token is
 * scoped to a single respondent within a single cohort; a row is only usable
 * when its invite is not revoked and the cohort is open.
 */
export async function resolveInvite(
  db: ClientBase,
  token: string,
): Promise<ResolvedInvite | null> {
  const { rows } = await db.query(
    `select r.id as respondent_id, r.cohort_id, r.is_facilitator
       from respondents r
       join cohorts c on c.id = r.cohort_id
      where r.invite_token = $1
        and r.invite_revoked_at is null
        and c.status = 'open'`,
    [token],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    respondentId: row.respondent_id,
    cohortId: row.cohort_id,
    isFacilitator: row.is_facilitator,
  };
}

/**
 * Generate a fresh invite token and assign it to a respondent, returning the
 * token. Re-issuing replaces the old token, so a previously shared link stops
 * working. Distinctness between respondents is enforced twice: the schema's
 * unique constraint on invite_token, and 32 bytes of entropy per value. The
 * respondents table is not RLS-gated; authorising who may call this (the
 * facilitator) is the route layer's job (F02-T06, F09).
 */
export async function issueInvite(
  db: ClientBase,
  respondentId: string,
): Promise<string> {
  const token = generateInviteToken();
  const { rowCount } = await db.query(
    "update respondents set invite_token = $1 where id = $2",
    [token, respondentId],
  );
  if (rowCount === 0) {
    throw new Error(`no respondent ${respondentId} to issue an invite to`);
  }
  return token;
}

/**
 * Revoke a respondent's invite. Thereafter resolveInvite returns null for their
 * token — every subsequent claim is rejected with the same neutral outcome as
 * an unknown token.
 */
export async function revokeInvite(
  db: ClientBase,
  respondentId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    "update respondents set invite_revoked_at = now() where id = $1",
    [respondentId],
  );
  if (rowCount === 0) {
    throw new Error(`no respondent ${respondentId} to revoke an invite for`);
  }
}