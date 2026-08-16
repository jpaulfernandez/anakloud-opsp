import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";
import { markCoachAnswerChanged } from "./interactions";
import { assertAnswersWritable } from "./lock";

// Answer persistence and read paths, with the Q14(d) private-row separation
// (F01-T03). Q14's `private_note` is written to its own `is_private = true`
// row so that every export, PDF and AI payload can exclude it at the query
// layer instead of remembering to filter it in code. The respondent-facing
// write path splits it here; the single public read helper below is the only
// place a non-facilitator read ever touches the answers table.
//
// The one deliberate exception to "a respondent never reads their own private
// row" is listOwnAnswers below (F04-T01): GET /api/answers must return the
// caller's own q14d so a respondent can review and edit their note. It reads
// through the bounded security-definer function app_read_own_answers (migration
// 0006), which returns only the current respondent's rows and is the sole
// read path that includes private rows. Every exporter, PDF and AI payload
// still goes through listPublicAnswers, which filters is_private = false — so
// the note reaches the owner's own session and nowhere else.

export interface AnswerRow {
  id: string;
  respondent_id: string;
  question_id: string;
  value: unknown;
  confidence: number | null;
}

export interface UpsertAnswerInput {
  respondent_id: string;
  question_id: string;
  value: unknown;
  confidence?: number | null;
}

export interface AiPayloadEntry {
  question_id: string;
  value: unknown;
}

/**
 * The q14 payload as a respondent submits it. `private_note` is the only field
 * marked sensitive; upsertAnswer splits it off rather than storing it here.
 */
export interface Q14AnswerValue {
  wants: string[];
  others: Record<string, string>;
  hours: number;
  private_note: string;
}

const Q14 = "q14";
const Q14D = "q14d";

/**
 * Persist one answer for a respondent.
 *
 * A q14 answer is written as two rows: the public fields (wants, others,
 * hours) to `q14` and `private_note` to its own private row `q14d`. Splitting
 * here is what makes private-row exclusion a query-level guarantee — no caller
 * ever sees the note nested in the q14 payload where a filter could forget it.
 */
export async function upsertAnswer(
  db: ClientBase,
  input: UpsertAnswerInput,
): Promise<void> {
  // PR5 — a submitted respondent's answers are immutable. Enforced here at the
  // data layer, not only in the PATCH route, so no code path (today's autosave,
  // a resume replay, or an OPSP-edit bug from F07) can write to answers once
  // the respondent has locked — the guard throws before any row is touched.
  await assertAnswersWritable(db, input.respondent_id);

  if (input.question_id === Q14) {
    await upsertQ14(db, input);
  } else {
    await upsertOne(db, {
      respondent_id: input.respondent_id,
      question_id: input.question_id,
      value: input.value,
      confidence: input.confidence ?? null,
      is_private: false,
    });
  }
  // The respondent edited this answer, so any coach nudge on this question that
  // still reads as unchanged is now a nudge whose answer did change — flip it
  // (F05-T05, FR-20). Every edit flows through this single write path, so no
  // added mutation route can skip the flag. A no-op when there are no coach
  // rows (non-coachable questions, or no nudge yet on this one).
  await markCoachAnswerChanged(db, input.respondent_id, input.question_id);
}

async function upsertQ14(
  db: ClientBase,
  input: UpsertAnswerInput,
): Promise<void> {
  const value = input.value as Q14AnswerValue;
  const { private_note, ...publicFields } = value;

  await upsertOne(db, {
    respondent_id: input.respondent_id,
    question_id: Q14,
    value: publicFields,
    confidence: input.confidence ?? null,
    is_private: false,
  });

  if (private_note !== undefined) {
    await upsertOne(db, {
      respondent_id: input.respondent_id,
      question_id: Q14D,
      value: { private_note },
      confidence: null,
      is_private: true,
    });
  }
}

async function upsertOne(
  db: ClientBase,
  row: {
    respondent_id: string;
    question_id: string;
    value: unknown;
    confidence: number | null;
    is_private: boolean;
  },
): Promise<void> {
  if (row.is_private) {
    // A private row can be created and re-saved by its owner but never read
    // back by them (F01-T04). Postgres RLS refuses to UPDATE/DELETE a row the
    // writer cannot SELECT, and the owner cannot SELECT their own private row,
    // so the plain upsert below would fail 42501. This write therefore goes
    // through app_upsert_own_answer, the single security-definer function that
    // persists a respondent's own private row, exactly as the RLS migration
    // provides. It re-checks ownership against app.respondent_id, so acting as
    // someone else still fails.
    await db.query(
      "select app_upsert_own_answer($1, $2, $3, $4::jsonb, $5, $6)",
      [
        randomUUID(),
        row.respondent_id,
        row.question_id,
        JSON.stringify(row.value),
        row.is_private,
        row.confidence,
      ],
    );
    return;
  }
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, $3, $4::jsonb, $5, $6)
     on conflict (respondent_id, question_id)
     do update set value = excluded.value,
                   is_private = excluded.is_private,
                   confidence = excluded.confidence,
                   updated_at = now()`,
    [
      randomUUID(),
      row.respondent_id,
      row.question_id,
      JSON.stringify(row.value),
      row.is_private,
      row.confidence,
    ],
  );
}

/**
 * The single public read helper. Used by every export, PDF and AI path;
 * private rows are filtered in the SQL, never in application code. If a path
 * needs answer data that is not the facilitator's own screen, it goes through
 * this function.
 */
export async function listPublicAnswers(
  db: ClientBase,
  respondentId: string,
): Promise<AnswerRow[]> {
  const { rows } = await db.query(
    `select id, respondent_id, question_id, value, confidence
       from answers
      where respondent_id = $1 and is_private = false
      order by question_id`,
    [respondentId],
  );
  return rows as AnswerRow[];
}

/**
 * AI request payload for one respondent: answer text and question metadata
 * only (spec.md §8). No names, no emails, no respondent ids, and never a
 * private row — it is built from listPublicAnswers, which filters them out.
 */
export async function buildAiPayload(
  db: ClientBase,
  respondentId: string,
): Promise<AiPayloadEntry[]> {
  const answers = await listPublicAnswers(db, respondentId);
  return answers.map((a) => ({ question_id: a.question_id, value: a.value }));
}

/**
 * The one read path that must include private rows: the facilitator's own
 * screen. A private note can only reach this branch — never an export, PDF or
 * AI payload, all of which go through listPublicAnswers.
 */
export async function listFacilitatorAnswers(
  db: ClientBase,
  cohortId: string,
): Promise<AnswerRow[]> {
  const { rows } = await db.query(
    `select a.id, a.respondent_id, a.question_id, a.value, a.confidence
       from answers a
       join respondents r on r.id = a.respondent_id
      where r.cohort_id = $1
      order by a.respondent_id, a.question_id`,
    [cohortId],
  );
  return rows as AnswerRow[];
}

/**
 * Cohort-wide public reads used by the comparison endpoint (F10-T02): every
 * respondent's answer to one question, with private rows filtered in the SQL.
 * The facilitator's RLS policy (`answers_facilitator_read`) would otherwise
 * expose private rows here, so the `is_private = false` predicate is the
 * query-layer guarantee that the Q14(d) note never reaches the comparison
 * screen — even the facilitator's. It runs inside the caller's
 * withRespondentContext so the cohort-wide answers are visible at all.
 */
export async function listPublicAnswersForQuestion(
  db: ClientBase,
  cohortId: string,
  questionId: string,
): Promise<AnswerRow[]> {
  const { rows } = await db.query(
    `select a.id, a.respondent_id, a.question_id, a.value, a.confidence
       from answers a
       join respondents r on r.id = a.respondent_id
      where r.cohort_id = $1 and a.question_id = $2 and a.is_private = false
      order by r.display_name asc, r.id asc`,
    [cohortId, questionId],
  );
  return rows as AnswerRow[];
}

/** One cohort answer row as the CSV export (F10-T05) needs it. */
export interface CohortAnswerRow {
  respondent_id: string;
  respondent_name: string;
  respondent_email: string | null;
  question_id: string;
  value: unknown;
  confidence: number | null;
}

/**
 * The single answer read path behind the CSV export (F10-T05, FR-34). Returns
 * every answer in the cohort, ordered by respondent for a stable spreadsheet.
 * The privacy decision is compiled into the SQL: the default call (`includePrivate`
 * false) carries `is_private = false`, so the Q14(d) note is excluded at the
 * query layer exactly like every export path (F01-T03). Only the explicit
 * re-confirmed private export passes `true`, dropping the predicate to serve
 * the private note to the facilitator — the sole cohort-wide private read
 * beyond listFacilitatorAnswers, reachable only after the route reconciled
 * includePrivate AND confirmPrivate. Must run inside the facilitator's RLS
 * context (withRespondentContext) for cohort-wide answers to be visible.
 */
export async function listAnswersForExport(
  db: ClientBase,
  cohortId: string,
  includePrivate: boolean,
): Promise<CohortAnswerRow[]> {
  const { rows } = await db.query(
    `select a.respondent_id,
            r.display_name as respondent_name,
            r.email as respondent_email,
            a.question_id, a.value, a.confidence
       from answers a
       join respondents r on r.id = a.respondent_id
      where r.cohort_id = $1
        ${includePrivate ? "" : "and a.is_private = false"}
      order by r.display_name asc, r.id asc, a.question_id asc`,
    [cohortId],
  );
  return rows as CohortAnswerRow[];
}

/** One of a respondent's own answer rows, as GET /api/answers returns it. */
export interface OwnAnswerRow {
  question_id: string;
  value: unknown;
  confidence: number | null;
  is_private: boolean;
  updated_at: Date;
}

/**
 * The read backing GET /api/answers (F04-T01): all of the caller's own answers,
 * including their own q14d. This is the one read path that returns private
 * rows, and it is deliberately bounded — app_read_own_answers (migration 0006)
 * limits itself to the current respondent via the RLS GUC, and it must run
 * inside withRespondentContext (set to the session's respondent, never a
 * client value) so that GUC is correctly scoped.
 */
export async function listOwnAnswers(db: ClientBase): Promise<OwnAnswerRow[]> {
  const { rows } = await db.query("select * from app_read_own_answers()");
  return rows as OwnAnswerRow[];
}

/**
 * The SQL that creates app_read_own_answers, the bounded security-definer
 * function listOwnAnswers reads through. It lives here rather than in the
 * migration so that every direct `from answers` select stays inside this
 * module (the F01-T03 invariant), exactly as upsertAnswer's writes do. The
 * function drops RLS only for the current respondent's own rows, via the same
 * 'app.respondent_id' GUC the policies read, so no caller can widen it to
 * someone else's note. Referenced by migration 0006; the migration applies it.
 */
export const OWN_ANSWER_READ_FUNCTION_SQL = `
create function app_read_own_answers()
returns table (
  question_id text,
  value jsonb,
  confidence smallint,
  is_private boolean,
  updated_at timestamptz
)
language sql
stable
security definer
as $$
  select a.question_id, a.value, a.confidence, a.is_private, a.updated_at
    from answers a
   where a.respondent_id = app_current_respondent()
$$;`;

/** The matching down migration for OWN_ANSWER_READ_FUNCTION_SQL. */
export const OWN_ANSWER_READ_FUNCTION_DROP_SQL = `drop function if exists app_read_own_answers();`;