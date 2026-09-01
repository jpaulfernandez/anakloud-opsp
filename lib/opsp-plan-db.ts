import type { ClientBase } from "./db";
import {
  CELL_REGISTRY,
  INITIAL_PLAN_VALUES,
  SURVEY_ANSWERS,
  FACILITATOR_NOTES,
  defaultContentForKind,
  type CellDef,
  type CellValue,
  type SurveyAnswer,
  type FacilitatorNote,
} from "./opsp-seed";

export interface PlanPayload {
  cells: Record<string, CellValue>;
  registry: readonly CellDef[];
  surveyAnswers: Record<string, SurveyAnswer[]>;
  facilitatorNotes: Record<string, FacilitatorNote[]>;
  audienceMode: "facilitator" | "room";
}

/**
 * Loads all plan cell values for a given plan ID.
 * Merges DB overrides on top of the initial seed values from lib/opsp-seed.ts.
 */
export async function loadPlanCells(
  db?: ClientBase | null,
  planId: string = "default",
): Promise<Record<string, CellValue>> {
  const result: Record<string, CellValue> = {};

  // 1. Initialize with seed values
  for (const def of CELL_REGISTRY) {
    const seedContent = INITIAL_PLAN_VALUES[def.id] ?? defaultContentForKind(def.kind, def);
    result[def.id] = {
      cellId: def.id,
      content: seedContent,
      updatedAt: new Date().toISOString(),
      updatedBy: "seed",
    };
  }

  // 2. If DB is provided, query saved values
  if (db) {
    try {
      const { rows } = await db.query<{
        cell_id: string;
        content: unknown;
        updated_at: Date;
        updated_by: string;
      }>(
        `select cell_id, content, updated_at, updated_by
           from opsp_plan_cell_values
          where plan_id = $1`,
        [planId],
      );

      for (const row of rows) {
        if (result[row.cell_id]) {
          result[row.cell_id] = {
            cellId: row.cell_id,
            content: row.content,
            updatedAt: row.updated_at.toISOString(),
            updatedBy: row.updated_by,
          };
        }
      }
    } catch {
      // If table doesn't exist yet (e.g. before migration), seed values are preserved.
    }
  }

  return result;
}

/**
 * Saves/upserts a single cell value to the database.
 */
export async function savePlanCell(
  db: ClientBase,
  cellId: string,
  content: unknown,
  updatedBy: string = "user",
  planId: string = "default",
): Promise<CellValue> {
  const now = new Date();
  await db.query(
    `insert into opsp_plan_cell_values (plan_id, cell_id, content, updated_at, updated_by)
     values ($1, $2, $3, $4, $5)
     on conflict (plan_id, cell_id)
     do update set content = $3, updated_at = $4, updated_by = $5`,
    [planId, cellId, JSON.stringify(content), now, updatedBy],
  );

  return {
    cellId,
    content,
    updatedAt: now.toISOString(),
    updatedBy,
  };
}

/**
 * Builds the full plan payload for the client, with audience-mode server-side gating.
 * When mode === 'room', facilitatorNotes are completely omitted from the payload.
 */
export async function getPlanPayload(
  db?: ClientBase | null,
  audienceMode: "facilitator" | "room" = "room",
  planId: string = "default",
): Promise<PlanPayload> {
  const cells = await loadPlanCells(db, planId);

  // Group survey answers by cellId
  const surveyAnswersMap: Record<string, SurveyAnswer[]> = {};
  for (const def of CELL_REGISTRY) {
    surveyAnswersMap[def.id] = [];
  }
  for (const answer of SURVEY_ANSWERS) {
    if (!surveyAnswersMap[answer.cellId]) {
      surveyAnswersMap[answer.cellId] = [];
    }
    surveyAnswersMap[answer.cellId].push(answer);
  }

  // Group facilitator notes by cellId (GATED by audienceMode)
  const facilitatorNotesMap: Record<string, FacilitatorNote[]> = {};
  for (const def of CELL_REGISTRY) {
    facilitatorNotesMap[def.id] = [];
  }

  if (audienceMode === "facilitator") {
    for (const note of FACILITATOR_NOTES) {
      if (!facilitatorNotesMap[note.cellId]) {
        facilitatorNotesMap[note.cellId] = [];
      }
      facilitatorNotesMap[note.cellId].push(note);
    }
  }

  return {
    cells,
    registry: CELL_REGISTRY,
    surveyAnswers: surveyAnswersMap,
    facilitatorNotes: facilitatorNotesMap,
    audienceMode,
  };
}
