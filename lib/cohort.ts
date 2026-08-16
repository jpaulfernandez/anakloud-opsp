import type { ClientBase } from "pg";

// Cohort roster reads (F03-T09, ui_ux.md §4.11). Q14(b) asks the respondent to
// name one function they think each teammate owns, one short field per person,
// with the names pre-filled from the cohort roster. That means the question
// needs the cohort's members by name — so the question page reads the roster
// and hands it to the Q14 input component, the same way it reads the respondent
// id for Q8's pool seed.

/** One cohort member as the Q14(b) rows need them: identity + display name. */
export interface CohortMember {
  id: string;
  displayName: string;
}

/**
 * The cohort roster, excluding the asking respondent. (b) is "for each
 * teammate, name the one function you think *they* own" — a respondent does not
 * name what they own of themselves, so the current respondent is excluded and
 * everyone else on the cohort is a teammate. Deterministic order by name so the
 * rows are stable across renders for the same cohort.
 */
export async function listCohortTeammates(
  db: ClientBase,
  cohortId: string,
  selfId: string,
): Promise<CohortMember[]> {
  const { rows } = await db.query<{ id: string; display_name: string }>(
    `select id, display_name
       from respondents
      where cohort_id = $1 and id <> $2
      order by display_name, id`,
    [cohortId, selfId],
  );
  return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
}