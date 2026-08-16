import type { ClientBase } from "pg";

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
// them to /welcome; one with a name has, so the claim restores the session.
// The welcome-page submit persists that name (and any email) onto the same
// respondents row, so the next claim flows straight past.

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
 * Where a freshly-authenticated respondent should land. No display name means
 * name entry is pending, so the welcome screen is the first-run destination; a
 * name already on file means the claim restores the session instead.
 */
export function welcomeDestination(
  displayName: string | null | undefined,
): string {
  return isProvidedDisplayName(displayName ?? "") ? "/" : "/welcome";
}

// --- Database helpers ----------------------------------------------------------

/**
 * The post-claim destination for one respondent, read from their current
 * display name: /welcome on first run, "/" once named.
 */
export async function claimDestination(
  db: ClientBase,
  respondentId: string,
): Promise<string> {
  const { rows } = await db.query<{ display_name: string | null }>(
    "select display_name from respondents where id = $1",
    [respondentId],
  );
  const row = rows[0];
  if (!row) throw new Error(`no respondent ${respondentId}`);
  return welcomeDestination(row.display_name);
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