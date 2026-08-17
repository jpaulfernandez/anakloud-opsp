import type { ClientBase } from "./db";

// Respondent onboarding — the display name and optional email the welcome
// screen persists on first claim (F02-T04, FR-2, ui_ux.md §4.1).
//
// The welcome screen is where a fresh respondent "confirms or types" their
// display name. The single rule that matters here is also a privacy principle:
// a name is *required* (non-blank), and nothing else is checked. "The system
// SHALL NOT validate the language, script or spelling of the display name"
// (FR-2) means exactly that — the product must not police how someone writes
// their own name, so the only validation is "did they write anything at all".
//
// `claimDestination` is the F02 feature's "a fresh invite link lands on name
// entry; a used one restores the session". Whether a freshly-authenticated
// respondent is first-run is keyed on whether they have given a display name:
// a respondent with none has not been through name entry, so a claim sends
// them to /welcome. The welcome-page submit persists that name (and any email)
// onto the same respondents row; claimLanding below then walks the same
// respondent through the ground-rules gate on the very next claim.

// The ground-rules acknowledgement is the second gate and it cannot be
// skipped (`ui_ux.md` §4.2; it is the mechanism that makes people answer
// honestly rather than diplomatically). It is recorded once on the
// respondents row and gates direct navigation to a question URL (FR-5): a
// respondent who reaches /q/... without having acknowledged is redirected to
// the ground-rules screen. A freshly-authenticated respondent is routed
// through both by claimLanding (used by claimDestination on a claim): no name
// means name entry is pending (/welcome); a name but no acknowledgement means
// the ground-rules screen is pending (/ground-rules); a name and an
// acknowledgement means the session restores at its destination (/). Both gate
// values live on the respondents row, so a used invite (a resume) walks
// straight past whichever one is already satisfied — neither screen re-shows
// once completed.

// --- Pure rules, unit-testable without a database -----------------------------

/** The name in canonical form: surrounding whitespace stripped. */
export function normalizeDisplayName(name: string): string {
  return name.trim();
}

/**
 * True only when the display name is usable: at least one non-whitespace
 * character. Nothing else is validated — script, spelling, symbols and digits
 * are all legitimate ways someone may write their own name (FR-2's SHALL NOT).
 */
export function isProvidedDisplayName(name: string): boolean {
  return normalizeDisplayName(name) !== "";
}

/**
 * Where a freshly-authenticated respondent should land after a claim. No
 * display name means name entry is pending (F02-T04, /welcome); a name but no
 * ground-rules acknowledgement means the ground-rules screen is pending
 * (F02-T05, /ground-rules); a name and an acknowledgement means the session is
 * restored. Nulls collapse to empty for the name check, and a missing
 * acknowledgement timestamp counts as not acknowledged.
 */
export function claimLanding(
  displayName: string | null | undefined,
  groundRulesAcknowledged: boolean,
): string {
  if (!isProvidedDisplayName(displayName ?? "")) return "/welcome";
  if (!groundRulesAcknowledged) return "/ground-rules";
  return "/";
}

// --- Database helpers ----------------------------------------------------------

/**
 * The post-claim destination for one respondent, read from their current
 * display name and ground-rules acknowledgement. /welcome on first run,
 * /ground-rules once named but not yet acknowledged, "/" once both are done.
 */
export async function claimDestination(
  db: ClientBase,
  respondentId: string,
): Promise<string> {
  const { rows } = await db.query<{
    display_name: string | null;
    ground_rules_acknowledged_at: unknown;
  }>(
    "select display_name, ground_rules_acknowledged_at from respondents where id = $1",
    [respondentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no respondent ${respondentId}`);
  return claimLanding(
    row.display_name,
    row.ground_rules_acknowledged_at !== null &&
      row.ground_rules_acknowledged_at !== undefined,
  );
}

/**
 * Whether a respondent has acknowledged the ground rules. Presence of the
 * timestamp is the whole test — a null means the gate is still pending.
 */
export async function groundRulesAcknowledged(
  db: ClientBase,
  respondentId: string,
): Promise<boolean> {
  const { rows } = await db.query<{ ack: unknown }>(
    "select ground_rules_acknowledged_at ack from respondents where id = $1",
    [respondentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no respondent ${respondentId}`);
  return row.ack !== null && row.ack !== undefined;
}

/**
 * Record the ground-rules acknowledgement. Idempotent: coalesce keeps the
 * *first* acknowledgement time, so a respondent who has already been through
 * the screen is never re-gated and later acknowledgements don't re-stamp it.
 */
export async function setGroundRulesAcknowledged(
  db: ClientBase,
  respondentId: string,
): Promise<void> {
  const { rowCount } = await db.query(
    `update respondents
        set ground_rules_acknowledged_at = coalesce(ground_rules_acknowledged_at, now())
      where id = $1`,
    [respondentId],
  );
  if (rowCount === 0) throw new Error(`no respondent ${respondentId}`);
}

/**
 * Persist the name and optional email the welcome screen collected. The name
 * is required — callers validate with isProvidedDisplayName first; a blank
 * email is stored as null so clearing the field removes an earlier value.
 */
export async function setRespondentName(
  db: ClientBase,
  respondentId: string,
  name: string,
  email: string,
): Promise<void> {
  const clean = normalizeDisplayName(name);
  const normalizedEmail = email.trim() === "" ? null : email.trim();
  const { rowCount } = await db.query(
    "update respondents set display_name = $1, email = $2 where id = $3",
    [clean, normalizedEmail, respondentId],
  );
  if (rowCount === 0) throw new Error(`no respondent ${respondentId}`);
}