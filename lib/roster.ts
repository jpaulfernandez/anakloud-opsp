import type { ClientBase } from "pg";
import { QUESTION_IDS } from "./questions";
import { withRespondentContext } from "./access";

// F09-T03 — the roster dashboard (FR-29, ui_ux.md §4.17).
//
// The roster shows who has been invited, who has started, who has finished,
// progress, last activity and time spent — and deliberately NO answer content
// (§4.17: "the facilitator will open it often and shouldn't absorb answers
// piecemeal"). That last rule is enforced by construction here, the same way
// the private note is: the roster's SQL selects only respondent identity and
// *aggregates* of the answers table (counts and timestamps), never
// `answers.value`. There is no field in the payload that answer text could
// reach, which is why "no answer text in the response payload" is a property
// of the query, not a filter someone must remember to add.
//
// The one subtlety is RLS. `answers` is gated on the current respondent
// (F01-T04), so a plain query sees nothing. The cohort facilitator is allowed
// cohort-wide read (answers_facilitator_read), so fetchRoster runs inside
// withRespondentContext with the facilitator as the acting respondent — which
// is exactly the RLS resolution the gate (F09-T01) has already let through:
// only a submitted facilitator reaches this code, so nobody reads their team's
// answers before their own are locked (FR-28).

export type RosterStatus = "not_started" | "in_progress" | "submitted";

/** The questionnaire's size: what `progress` is measured against. */
export const ROSTER_TOTAL_QUESTIONS = QUESTION_IDS.length;

/**
 * An F06-T05 unlock, surfaced on the roster as the ticket requires. Stamped on
 * the target respondent when a facilitator reopens them; `byName` is the
 * acting facilitator's display name and `at` the moment it happened.
 */
export interface RosterUnlockEvent {
  byName: string;
  at: Date;
}

/** One row of the roster. Pure derivation; the raw fetch maps into this. */
export interface RosterEntry {
  respondentId: string;
  name: string;
  status: RosterStatus;
  /** Number of distinct public questions answered (q14d excluded at the query). */
  progress: number;
  /** Total questions in the questionnaire (ROSTER_TOTAL_QUESTIONS). */
  total: number;
  /** Most recent activity: the last answer edit, or the submission itself. */
  lastActiveAt: Date | null;
  /** Elapsed seconds from first activity to submission (or now, while open). */
  timeSpentSeconds: number | null;
  isFacilitator: boolean;
  /** The F06-T05 unlock audit, when this respondent was reopened. */
  unlock: RosterUnlockEvent | null;
}

/**
 * Derive the respondent's status. Submission wins over everything; an
 * unlocked respondent falls back to in_progress because their answers are open
 * again. A respondent with no answers at all is "not started" — they may have
 * claimed and read the ground rules, but they have not begun answering.
 */
export function rosterStatus(
  submittedAt: Date | null,
  answeredPublicQuestions: number,
): RosterStatus {
  if (submittedAt !== null && submittedAt !== undefined) return "submitted";
  if (answeredPublicQuestions > 0) return "in_progress";
  return "not_started";
}

/**
 * The most recent activity to display: the last answer edit, or the submission
 * itself when that was later. Null when the respondent has done neither.
 */
export function rosterLastActiveAt(
  submittedAt: Date | null,
  lastActivityAt: Date | null,
): Date | null {
  const candidates = [submittedAt, lastActivityAt].filter(
    (d): d is Date => d !== null && d !== undefined,
  );
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

/**
 * The wall-clock span of the respondent's engagement, from their first answer
 * to their submission — or to `now` while they are still working. Null when
 * there is no activity to measure (never started). Rounded up to whole
 * seconds and floored at zero.
 */
export function rosterTimeSpentSeconds(
  submittedAt: Date | null,
  firstActivityAt: Date | null,
  now: Date,
): number | null {
  if (firstActivityAt === null || firstActivityAt === undefined) return null;
  const end = submittedAt ?? now;
  const seconds = Math.round((end.getTime() - firstActivityAt.getTime()) / 1000);
  return Math.max(0, seconds);
}

/** The raw row shape fetchRoster receives from SQL, before pure derivation. */
export interface RosterRawRow {
  respondentId: string;
  name: string;
  isFacilitator: boolean;
  submittedAt: Date | null;
  answeredPublic: number;
  firstActivityAt: Date | null;
  lastActivityAt: Date | null;
  unlockedAt: Date | null;
  unlockedByName: string | null;
  /** The "now" of this request, so time-spent is deterministic to derive. */
  now: Date;
}

/**
 * Map a raw SQL row into a roster entry. Pure on purpose: the status /
 * progress / last-active / time-spent rules are asserted exhaustively in
 * unit tests without a database, and only fetchRoster (and its SQL) need one.
 */
export function buildRosterEntry(raw: RosterRawRow): RosterEntry {
  const unlocked = raw.unlockedAt !== null && raw.unlockedAt !== undefined;
  return {
    respondentId: raw.respondentId,
    name: raw.name,
    status: rosterStatus(raw.submittedAt, raw.answeredPublic),
    progress: raw.answeredPublic,
    total: ROSTER_TOTAL_QUESTIONS,
    lastActiveAt: rosterLastActiveAt(raw.submittedAt, raw.lastActivityAt),
    timeSpentSeconds: rosterTimeSpentSeconds(
      raw.submittedAt,
      raw.firstActivityAt,
      raw.now,
    ),
    isFacilitator: raw.isFacilitator,
    unlock: unlocked ? { byName: raw.unlockedByName ?? "", at: raw.unlockedAt! } : null,
  };
}

/**
 * Read the cohort's roster for the facilitator's dashboard. `actorRespondentId`
 * is the submitted facilitator from the already-passed admin gate; running the
 * query inside their RLS context is what makes the answers aggregates visible
 * (answers_facilitator_read). The query selects respondent metadata and answer
 * aggregates only — never `answers.value` — so no answer text can enter the
 * payload (FR-29).
 */
export async function fetchRoster(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
): Promise<RosterEntry[]> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const now = new Date();
    const { rows } = await tx.query(
      `select r.id                         as respondent_id,
              r.display_name               as name,
              r.is_facilitator,
              r.submitted_at               as submitted_at,
              r.unlocked_at                as unlocked_at,
              u.display_name               as unlocked_by_name,
              count(distinct a.question_id) filter (where a.is_private = false)::int
                                           as answered_public,
              min(a.updated_at)            as first_activity_at,
              max(a.updated_at)            as last_activity_at
         from respondents r
         join cohorts c on c.id = r.cohort_id
         left join respondents u on u.id = r.unlocked_by
         left join answers a on a.respondent_id = r.id
        where c.id = $1
        group by r.id, r.display_name, r.is_facilitator,
                 r.submitted_at, r.unlocked_at, u.display_name
        order by r.display_name asc, r.id asc`,
      [cohortId],
    );

    return rows.map((row) =>
      buildRosterEntry({
        respondentId: row.respondent_id,
        name: row.name,
        isFacilitator: row.is_facilitator,
        submittedAt: row.submitted_at,
        answeredPublic: row.answered_public,
        firstActivityAt: row.first_activity_at,
        lastActivityAt: row.last_activity_at,
        unlockedAt: row.unlocked_at,
        unlockedByName: row.unlocked_by_name,
        now,
      }),
    );
  });
}