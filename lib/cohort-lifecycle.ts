import type { ClientBase } from "pg";
import { AI_LEVELS, type AiLevel, type ResolvedLevel } from "./config";
import { withRespondentContext } from "./access";

// Cohort lifecycle (F09-T05, spec.md §8/§9, tech_infrastructure.md §3/§9,
// ui_ux.md §6 "Cohort closed"). The facilitator moves their cohort between
// draft / open / closed, pins the AI level for it, and deletes the whole
// cohort in one cascading action. Every path here is facilitator-only and
// reached through the submitted-facilitator gate (F09-T01); the cohortId is
// always the session's own, never taken from the client. `cohorts` carries no
// row-level security (F01-T04 gates only answers, answer_snapshots and
// opsp_drafts), so the status / pin writes are plain updates scoped by id.
//
// Deletion is the one operation with teeth and it is deliberately owed to a
// database function: it must cascade to every dependent row (answers, answer
// snapshots, OPSP drafts, AI interactions, budget) AND require the facilitator
// to type the cohort's name to confirm. Doing both inside one
// security-definer function keeps the confirmation and the cascade atomic — a
// name mismatch raises before any row is touched, and the superuser-owned
// function bypasses RLS so a cohort's answers can be deleted in one go even
// though a respondent can only ever see their own rows.

/** The three lifecycle states a cohort can be in (tech_infrastructure §3). */
export const COHORT_STATUSES = ["draft", "open", "closed"] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

/**
 * A level a facilitator may pin a cohort to, or "auto" to follow the boot
 * default. Only `AiLevel` values are ever stored; "auto" is the absence of a
 * pin (null in the column).
 */
export type CohortLevelPin = AiLevel | "auto";

/** The accepted values for a level-pin request, including "auto". */
export const COHORT_LEVEL_PINS: readonly CohortLevelPin[] = [...AI_LEVELS, "auto"];

/** Validate and normalise a status value; null when it is not draft/open/closed. */
export function parseCohortStatus(value: unknown): CohortStatus | null {
  return typeof value === "string" &&
    (COHORT_STATUSES as readonly string[]).includes(value)
    ? (value as CohortStatus)
    : null;
}

/** Validate a level-pin value ("auto" allowed); null when invalid. */
export function parseCohortLevelPin(value: unknown): CohortLevelPin | null {
  if (value === "auto") return "auto";
  return typeof value === "string" && (AI_LEVELS as readonly string[]).includes(value)
    ? (value as AiLevel)
    : null;
}

/** The cohorts row the admin lifecycle control needs, exactly as stored. */
export interface CohortLifecycleState {
  name: string;
  status: CohortStatus;
  /** "L0".."L3" when pinned; null when automatic. */
  aiLevelPin: string | null;
}

/**
 * A name-confirmation failure: the request named the cohort, but the stored
 * name did not match, so nothing was deleted. The SHALL NOT is atomic — the
 * mismatch raises inside app_delete_cohort before any dependent row is gone.
 */
export class CohortNameMismatchError extends Error {
  constructor() {
    super("cohort name confirmation does not match");
    this.name = "CohortNameMismatchError";
  }
}

/** The cohort does not exist (it was already deleted, or never was). */
export class CohortNotFoundError extends Error {
  constructor() {
    super("cohort not found");
    this.name = "CohortNotFoundError";
  }
}

/**
 * Read the facilitator's own cohort for the dashboard lifecycle control. Null
 * when the cohort row is missing.
 */
export async function fetchCohortLive(
  db: ClientBase,
  cohortId: string,
): Promise<CohortLifecycleState | null> {
  const { rows } = await db.query<{
    name: string;
    status: CohortStatus;
    ai_level_pin: string | null;
  }>(
    `select name, status, ai_level_pin
       from cohorts
      where id = $1`,
    [cohortId],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return { name: r.name, status: r.status, aiLevelPin: r.ai_level_pin };
}

/**
 * Move the cohort between draft / open / closed. A plain scoped update; the
 * read-only consequence of `closed` is enforced where it matters — sessions
 * resolve `readOnly` live from this column on every request, and the mutation
 * routes refuse writes when it is set (lib/lock.ts).
 */
export async function setCohortStatus(
  db: ClientBase,
  cohortId: string,
  status: CohortStatus,
): Promise<void> {
  await db.query("update cohorts set status = $1 where id = $2", [status, cohortId]);
}

/**
 * Pin the cohort's AI level. `auto` stores null (follow the boot default); a
 * concrete L0..L3 is stored as-is. Resolution happens per request from this
 * column (resolveServedLevel), so a pin takes effect on the next request
 * without a redeploy — that is the F09-T05 acceptance.
 */
export async function setCohortLevelPin(
  db: ClientBase,
  cohortId: string,
  pin: CohortLevelPin,
): Promise<void> {
  const stored = pin === "auto" ? null : pin;
  await db.query("update cohorts set ai_level_pin = $1 where id = $2", [stored, cohortId]);
}

/**
 * The level the cohort is served at, given the deterministic boot level and
 * the cohort's own pin. A cohort pin always wins; a null pin (automatic) falls
 * back to the boot default. Stored pins are validated to L0..L3 by
 * setCohortLevelPin, so an unrecognised value is treated as automatic rather
 * than surfacing a fabricated level.
 */
export function resolveServedLevel(
  boot: ResolvedLevel,
  cohortPin: string | null,
): ResolvedLevel {
  if (cohortPin !== null && (AI_LEVELS as readonly string[]).includes(cohortPin)) {
    return cohortPin as AiLevel;
  }
  return boot;
}

/**
 * Delete the whole cohort and every dependent row, as one facilitator action.
 * Runs inside the acting facilitator's context so `app_delete_cohort` can
 * verify they are the cohort's facilitator, and the function itself requires
 * the name confirmation and cascades the deletes atomically — a mismatch
 * leaves every row in place.
 */
export async function deleteCohort(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  expectedName: string,
): Promise<void> {
  await withRespondentContext(db, actorRespondentId, async () => {
    try {
      await db.query("select app_delete_cohort($1, $2)", [cohortId, expectedName]);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "P0002") throw new CohortNotFoundError();
      if (code === "F0901") throw new CohortNameMismatchError();
      throw err;
    }
  });
}

/**
 * The SQL for app_delete_cohort, the single cascading delete. It lives here so
 * the backend that uses it and the migration that applies it cannot drift (the
 * same arrangement as app_upsert_own_answer in lib/answers.ts). It is a
 * security-definer function owned by the migration role, so it bypasses the
 * answers RLS that would otherwise stop a facilitator deleting a respondent's
 * rows — exactly what "full cohort deletion, cascading" needs.
 */
export const COHORT_LIFECYCLE_UP_SQL = `
create function app_delete_cohort(
  p_cohort_id uuid,
  p_expected_name text
) returns void
language plpgsql
security definer
as $$
declare
  v_name text;
begin
  select name into v_name from cohorts where id = p_cohort_id;

  if not found then
    raise exception 'cohort not found' using errcode = 'P0002';
  end if;

  -- Only the cohort's facilitator may delete it, verified against the same
  -- 'app.respondent_id' GUC the RLS policies read (set by withRespondentContext).
  if not app_is_facilitator_of_cohort(p_cohort_id) then
    raise exception 'not the cohort facilitator' using errcode = '42501';
  end if;

  -- The explicit confirmation MUST name the cohort; a mismatch raises before
  -- any dependent row is touched, leaving the cohort fully intact.
  if v_name is distinct from p_expected_name then
    raise exception 'cohort name confirmation does not match' using errcode = 'F0901';
  end if;

  -- Cascade in dependency order: every row that could reference the cohort or
  -- one of its respondents is removed before the respondents and the cohort
  -- themselves. These are respondent-keyed via the cohort's membership.
  delete from ai_budget where cohort_id = p_cohort_id;
  delete from ai_interactions
    where respondent_id in (select id from respondents where cohort_id = p_cohort_id);
  delete from opsp_drafts where cohort_id = p_cohort_id;
  delete from answer_snapshots
    where respondent_id in (select id from respondents where cohort_id = p_cohort_id);
  delete from answers
    where respondent_id in (select id from respondents where cohort_id = p_cohort_id);
  delete from respondents where cohort_id = p_cohort_id;
  delete from cohorts where id = p_cohort_id;
end;
$$;`;

/** The matching down migration for COHORT_LIFECYCLE_UP_SQL. */
export const COHORT_LIFECYCLE_DOWN_SQL = `drop function if exists app_delete_cohort(uuid, text);`;