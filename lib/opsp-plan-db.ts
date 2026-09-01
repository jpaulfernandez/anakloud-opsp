import type { ClientBase } from "./db";
import {
  listPublicSubmittedAnswersWithNames,
  type PublicAnswerWithRespondent,
} from "./answers";
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
      // If table doesn't exist yet, seed values are preserved.
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
 * Seeds all 32 plan cell values from INITIAL_PLAN_VALUES into the database.
 * Idempotent: upserts all cells under the given plan ID.
 */
export async function seedPlanCells(
  db: ClientBase,
  planId: string = "default",
): Promise<void> {
  const now = new Date();
  for (const def of CELL_REGISTRY) {
    const content = INITIAL_PLAN_VALUES[def.id] ?? defaultContentForKind(def.kind, def);
    await db.query(
      `insert into opsp_plan_cell_values (plan_id, cell_id, content, updated_at, updated_by)
       values ($1, $2, $3, $4, 'seed')
       on conflict (plan_id, cell_id)
       do update set content = $3, updated_at = $4, updated_by = 'seed'`,
      [planId, def.id, JSON.stringify(content), now],
    );
  }
}

/**
 * Maps raw database answers from real submitted respondents to OPSP cell survey answers.
 */
function mapDbAnswersToCells(rows: PublicAnswerWithRespondent[]): Record<string, SurveyAnswer[]> {
  const map: Record<string, SurveyAnswer[]> = {};
  for (const def of CELL_REGISTRY) {
    map[def.id] = [];
  }

  for (const row of rows) {
    const person = row.display_name;
    const qid = row.question_id;
    const val = row.value || {};
    const conf = typeof row.confidence === "number" ? row.confidence : undefined;

    switch (qid) {
      case "q1": {
        if (typeof val.text === "string") {
          map["PU-1"].push({ cellId: "PU-1", person, answer: val.text, confidence: conf });
        }
        break;
      }
      case "q2": {
        if (val.who || val.because) {
          const ans = `Who would miss us: ${val.who || "—"}\nBecause: ${val.because || "—"}`;
          map["PU-1"].push({ cellId: "PU-1", person, answer: ans, confidence: conf });
        }
        break;
      }
      case "q3": {
        const metric = String(val.metric || "Target");
        const targetVal = String(val.value || "—");
        const unit = String(val.unit || "");
        const why = String(val.why || "");

        map["T35-2"].push({
          cellId: "T35-2",
          person,
          answer: `${metric} — ${targetVal} ${unit}\nWhy: ${why}`,
          confidence: conf,
          meta: { metric, target: targetVal, unit },
        });

        map["G1-2"].push({
          cellId: "G1-2",
          person,
          answer: `Target metric: ${metric} — ${targetVal} ${unit}`,
          confidence: conf,
        });

        map["G1-4"].push({
          cellId: "G1-4",
          person,
          answer: `${metric} — ${targetVal} ${unit}\nWhy: ${why}`,
          confidence: conf,
        });
        break;
      }
      case "q4": {
        if (typeof val.text === "string") {
          map["PU-2"].push({ cellId: "PU-2", person, answer: val.text, confidence: conf });
        }
        break;
      }
      case "q5": {
        const pays = Array.isArray(val.pays) ? val.pays.join(", ") : "";
        const decides = Array.isArray(val.decides) ? val.decides.join(", ") : "";
        const uses = Array.isArray(val.uses) ? val.uses.join(", ") : "";
        const benefits = Array.isArray(val.benefits) ? val.benefits.join(", ") : "";
        const text = `Pays: ${pays || "—"}\nDecides: ${decides || "—"}\nUses: ${uses || "—"}\nBenefits: ${benefits || "—"}`;
        map["T35-3"].push({ cellId: "T35-3", person, answer: text, confidence: conf });
        break;
      }
      case "q6": {
        const choice = String(val.choice || "");
        const why = String(val.why || "");
        map["T35-3"].push({
          cellId: "T35-3",
          person,
          answer: `Core customer choice: ${choice}\nWhy: ${why}`,
          confidence: conf,
        });
        break;
      }
      case "q7": {
        if (typeof val.text === "string") {
          map["T35-4"].push({ cellId: "T35-4", person, answer: val.text, confidence: conf });
        }
        break;
      }
      case "q8": {
        const rank = Array.isArray(val.rank) ? val.rank : [];
        const del = String(val.delete || "");
        const why = String(val.why || "");
        const lead = rank[0] || "";
        const text = `Lead wedge: ${lead} (Full ranking: ${rank.join(" → ")})\nKill / De-prioritize: ${del}\nWhy: ${why}`;
        map["T35-5"].push({
          cellId: "T35-5",
          person,
          answer: text,
          confidence: conf,
          meta: { rank1: lead, kill: del },
        });
        break;
      }
      case "q9": {
        const items = Array.isArray(val.items) ? val.items : [];
        if (items.length > 0) {
          const listText = items.map((it, i) => `${i + 1}. ${it}`).join("\n");
          map["T35-3b"].push({ cellId: "T35-3b", person, answer: listText, confidence: conf });
          map["CV"].push({
            cellId: "CV",
            person,
            answer: `Guardrails / Refusals:\n${listText}`,
            confidence: conf,
          });
        }
        break;
      }
      case "q10": {
        const payer = Array.isArray(val.payer) ? val.payer.join(", ") : String(val.payer || "");
        const model = String(val.model || "");
        const amount = String(val.amount || "");
        const unit = String(val.unit || "");
        const firstPeso = String(val.first_peso || "");
        const text = `Payer: ${payer}\nModel: ${model}\nAmount: ₱${amount} (${unit})\nFirst peso: ${firstPeso}`;
        map["T35-6"].push({
          cellId: "T35-6",
          person,
          answer: text,
          confidence: conf,
          meta: { model, amount: `₱${amount}`, firstPeso },
        });
        map["G1-2"].push({
          cellId: "G1-2",
          person,
          answer: `Monetization: ₱${amount} (${unit}) via ${model}. First peso: ${firstPeso}`,
          confidence: conf,
        });
        break;
      }
      case "q11": {
        const rocks = Array.isArray(val.rocks) ? (val.rocks as Array<{ what?: string; done_when?: string }>) : [];
        const starred = typeof val.starred === "number" ? val.starred : -1;
        if (rocks.length > 0) {
          const formatted = rocks
            .map((r, i) => `${i === starred ? "★ [Priority #1] " : ""}${r.what || ""}\nDone when: ${r.done_when || ""}`)
            .join("\n\n");
          map["G1-3"].push({ cellId: "G1-3", person, answer: formatted, confidence: conf });
          map["A90-3"].push({ cellId: "A90-3", person, answer: formatted, confidence: conf });
        }
        break;
      }
      case "q12": {
        if (typeof val.text === "string") {
          map["TH-3"].push({ cellId: "TH-3", person, answer: val.text, confidence: conf });
        }
        break;
      }
      case "q13": {
        const text = String(val.text || "");
        const cause = String(val.cause || "");
        const full = `${text}\nPrimary risk / cause: ${cause}`;
        map["SWT-2"].push({ cellId: "SWT-2", person, answer: full, confidence: conf });
        map["G1-5"].push({ cellId: "G1-5", person, answer: `Pre-mortem risk: ${full}`, confidence: conf });
        map["TH-7"].push({ cellId: "TH-7", person, answer: `Risk: ${full}`, confidence: conf });
        break;
      }
      case "q14": {
        const wants = Array.isArray(val.wants) ? val.wants.join(", ") : "";
        const hours = String(val.hours || "");
        const text = `Functions to own: ${wants || "—"}\nCommitted time: ${hours} hrs/week`;
        map["AC-1"].push({
          cellId: "AC-1",
          person,
          answer: text,
          confidence: conf,
          meta: { hours: `${hours} hrs/wk`, wants },
        });
        map["AC-2"].push({
          cellId: "AC-2",
          person,
          answer: text,
          confidence: conf,
        });
        break;
      }
      case "q15": {
        if (typeof val.text === "string") {
          map["CV"].push({
            cellId: "CV",
            person,
            answer: `Story worth copying:\n${val.text}`,
            confidence: conf,
          });
        }
        break;
      }
    }
  }

  return map;
}

/**
 * Builds the full plan payload for the client, with audience-mode server-side gating.
 * Pulls real submitted survey answers from the database when connected, or falls back
 * to static fixtures when offline/in tests.
 * When mode === 'room', facilitatorNotes are completely omitted from the payload.
 */
export async function getPlanPayload(
  db?: ClientBase | null,
  audienceMode: "facilitator" | "room" = "room",
  planId: string = "default",
): Promise<PlanPayload> {
  const cells = await loadPlanCells(db, planId);

  // Group survey answers by cellId
  let surveyAnswersMap: Record<string, SurveyAnswer[]> = {};
  for (const def of CELL_REGISTRY) {
    surveyAnswersMap[def.id] = [];
  }

  let dbAnswersLoaded = false;
  if (db) {
    try {
      const rows = await listPublicSubmittedAnswersWithNames(db);
      if (rows.length > 0) {
        surveyAnswersMap = mapDbAnswersToCells(rows);
        dbAnswersLoaded = true;
      }
    } catch {
      // Fall back to seed answers
    }
  }

  if (!dbAnswersLoaded) {
    for (const answer of SURVEY_ANSWERS) {
      if (!surveyAnswersMap[answer.cellId]) {
        surveyAnswersMap[answer.cellId] = [];
      }
      surveyAnswersMap[answer.cellId].push(answer);
    }
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
