import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";

// Answer persistence and read paths, with the Q14(d) private-row separation
// (F01-T03). Q14's `private_note` is written to its own `is_private = true`
// row so that every export, PDF and AI payload can exclude it at the query
// layer instead of remembering to filter it in code. The respondent-facing
// write path splits it here; the single public read helper below is the only
// place a non-facilitator read ever touches the answers table.

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
  if (input.question_id === Q14) {
    await upsertQ14(db, input);
    return;
  }
  await upsertOne(db, {
    respondent_id: input.respondent_id,
    question_id: input.question_id,
    value: input.value,
    confidence: input.confidence ?? null,
    is_private: false,
  });
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