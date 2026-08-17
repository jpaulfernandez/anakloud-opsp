// F14-T06 — durable retention of facilitator-analysis outputs (FR-35,
// tech_infrastructure.md §6.4 / spec.md §5.5). The L1 retry queue keeps at
// most one completed read in process-local memory (F14-T02); a facilitator who
// re-runs an analysis — or reloads the page — must be able to see the previous
// output and what changed in the new one, so this module persists every serve
// of POST /api/admin/analyse to its own row (migration 0010).
//
// Privacy follows the same discipline as the payload builder (F14-T01) and the
// deterministic scoring: the read helpers write and read through the cohort
// facilitator's RLS context, so only the cohort's facilitator can record or
// retrieve an output, and the payloads those rows store were themselves built
// from the public answer helpers, so a private row (Q14(d)) can never reach
// them. Nothing here ever recomputes or joins answers — the whole serve body
// is stored whole, exactly as it was served.
//
// The two pure seams — extracting an output's label fields and appending to a
// retained history — live here so the ticket's acceptance criteria
// (re-running preserves the prior output and its label; a model change is
// visible; the level is recorded per output) are unit-testable without a
// database, next to the DB-backed integration tests that prove the rows.

import { randomUUID } from "node:crypto";
import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import type {
  AnalyseScope,
  AnalysisServeBody,
} from "./analyse-endpoint";
import type { QuestionId } from "./questions";

/**
 * The fields FR-35 records alongside every output: the serving level and the
 * pinned model id used, both called out verbatim by F14-T06. `model` clears to
 * "" when no model ran (the deterministic branch), exactly as the panel footer
 * does — never an alias and never an "unavailable" affordance.
 */
export interface AnalysisOutputMeta {
  scope: AnalyseScope;
  questionId: QuestionId | null;
  /** The serving level at generation: L0..L3. */
  level: AnalysisServeBody["level"];
  /** The pinned model id that produced the output, or "" when none ran. */
  model: string;
  /** ISO-8601 timestamp of this output's generation. */
  generatedAt: string;
}

/**
 * Derive the persisted label/meta fields from a served body. Pure, so the
 * store's column selection (level recorded per output, model change visible,
 * timestamp kept for ordering) is unit-testable without touching Postgres.
 */
export function analysisOutputMeta(body: AnalysisServeBody): AnalysisOutputMeta {
  return {
    scope: body.scope,
    questionId: body.questionId,
    level: body.level,
    model: body.label.model,
    generatedAt: body.label.generatedAt,
  };
}

/**
 * The retention rule: a re-run appends to the retained history, never
 * overwriting anything already there. Pure — the caller's current list plus the
 * fresh output yields the new list, older entries and their labels intact.
 */
export function appendAnalysisHistory(
  previous: readonly AnalysisServeBody[],
  fresh: AnalysisServeBody,
): AnalysisServeBody[] {
  return [...previous, fresh];
}

/**
 * Persist one serve of POST /api/admin/analyse as its own durable row. Runs
 * inside the facilitator's RLS context so the insert policy admits it; a
 * non-facilitator or unsubmitted respondent writing here would be silently
 * blocked by the policy. The body is stored whole so the panel can re-render
 * exactly what was served.
 */
export async function recordAnalysisOutput(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  body: AnalysisServeBody,
): Promise<void> {
  const meta = analysisOutputMeta(body);
  await withRespondentContext(db, actorRespondentId, async (tx) => {
    await tx.query(
      `insert into analysis_outputs
         (id, cohort_id, scope, question_id, level, model, generated_at, body)
       values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        randomUUID(),
        cohortId,
        meta.scope,
        meta.questionId,
        meta.level,
        meta.model === "" ? null : meta.model,
        meta.generatedAt,
        JSON.stringify(body),
      ],
    );
  });
}

/**
 * Read every retained output for one analysis scope, oldest first, so a re-run
 * is always the last item and a change in the read is visible against what
 * came before. Reads through the facilitator's RLS context, so only the cohort
 * facilitator sees this prep material. `question_id is not distinct from` keeps
 * the cohort-wide rows (question_id null) and the per-question rows apart.
 */
export async function listAnalysisOutputs(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  scope: AnalyseScope,
  questionId: QuestionId | null,
): Promise<AnalysisServeBody[]> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const { rows } = await tx.query<{ body: AnalysisServeBody }>(
      `select body from analysis_outputs
        where cohort_id = $1 and scope = $2 and question_id is not distinct from $3
        order by generated_at asc, id asc`,
      [cohortId, scope, questionId],
    );
    return rows.map((r) => r.body);
  });
}