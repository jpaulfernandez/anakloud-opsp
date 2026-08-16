import { randomUUID } from "node:crypto";
import type { ClientBase } from "pg";

// Coach interaction logging (F05-T05, spec.md FR-20, tech_infrastructure.md §3).
//
// The `ai_interactions` table is the contamination audit: it exists so the
// facilitator can find out whether coaching pushed the six answers toward each
// other. Logging it from the deterministic L2 coach means there is a pre-AI
// baseline to compare against — the exact rows written here are what F13's
// live-model rows will be compared with. Each nudge card shown is one `coach`
// row recording the question, the attempt number (1..3), the verdict, the hint
// text and whether an example was requested; `answer_changed` flips to true
// when the respondent later edits the answer, which is the signal the audit
// keys on.
//
// This module is deliberately the *only* place coach content is retained. No
// answer text, no respondent name/email/id is written anywhere here, and the
// caller never hands us a value — only the static hint text, which is the same
// for everyone (F05-T02's documented anchoring cost). That keeps "the
// ai_interactions table is the only place coach content is retained" and "no
// answer text in application logs" both true by construction.

/** One coach nudge, as recorded in `ai_interactions`. */
export interface CoachInteraction {
  question_id: string;
  /** 1..3 — the honest attempt counter (FR-17). */
  attempt_no: number;
  /** The verdict that served the nudge; "needs_work" for any nudge card. */
  verdict: string;
  /** The static hint shown on the card (F05-T02). */
  hint_text: string;
  example_shown: boolean;
  /** The degradation level that served it; "L2" for the deterministic coach. */
  level: string;
}

/**
 * Write one coach nudge to `ai_interactions`. A row starts with
 * `answer_changed = false`; a later edit flips it via markCoachAnswerChanged.
 * `respondent_id` comes from the session (this module never accepts one from a
 * caller-selected value), so a logged interaction is always attributable to
 * the actual actor.
 */
export async function logCoachInteraction(
  db: ClientBase,
  respondentId: string,
  interaction: CoachInteraction,
): Promise<void> {
  await db.query(
    `insert into ai_interactions (
       id, respondent_id, question_id, purpose, attempt_no, level, verdict,
       hint_text, example_shown, answer_changed
     ) values ($1, $2, $3, 'coach', $4, $5, $6, $7, $8, false)`,
    [
      randomUUID(),
      respondentId,
      interaction.question_id,
      interaction.attempt_no,
      interaction.level,
      interaction.verdict,
      interaction.hint_text,
      interaction.example_shown,
    ],
  );
}

/**
 * Mark an example as requested on the most recent coach row for a question.
 * The example is offered at the card (F05-T04) and requested against the
 * nudge that is currently on screen, which is the newest row — so this updates
 * exactly that one, leaving earlier nudges' rows at `example_shown = false`.
 */
export async function setExampleShown(
  db: ClientBase,
  respondentId: string,
  questionId: string,
): Promise<void> {
  await db.query(
    `update ai_interactions set example_shown = true
      where id = (
        select id
          from ai_interactions
         where respondent_id = $1 and question_id = $2 and purpose = 'coach'
         order by created_at desc, id desc
         limit 1
      )`,
    [respondentId, questionId],
  );
}

/**
 * Flip `answer_changed` to true on every coach row for a question that still
 * reads as unchanged. Called from the answer write path (upsertAnswer) whenever
 * a respondent edits an answer, so a nudge whose answer later changes is the
 * record the contamination audit flags.
 */
export async function markCoachAnswerChanged(
  db: ClientBase,
  respondentId: string,
  questionId: string,
): Promise<void> {
  await db.query(
    `update ai_interactions set answer_changed = true
      where respondent_id = $1 and question_id = $2 and purpose = 'coach'
        and coalesce(answer_changed, false) = false`,
    [respondentId, questionId],
  );
}