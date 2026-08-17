// CSV export of all answers (F10-T05, FR-34, tech_infrastructure.md §4, §9).
//
// GET /api/admin/export is the one export that can, on explicit re-confirmed
// request, release Q14(d) private rows — so the privacy posture lives here, in
// the data layer, next to the server doc's rule ("is_private rows are excluded
// at the query layer in every export"). The default (and any request that has
// not explicitly *confirmed*) carries `include_private = false`, and the
// private filter is compiled into the SQL (lib/answers.ts) — the note cannot
// reach the CSV by a forgotten filter. Only when a caller passes BOTH
// `includePrivate=true` AND `confirmPrivate=true` does the private path engage:
// that is the "explicit re-confirmation" the requirement demands, and only
// then is the export recorded in `export_events` (migration 0008). A request
// that asks for private rows but omits the confirmation degrades to a public
// export rather than erroring — the failure is silently safe, never a leak.
//
// The spreadsheet shape is one row per respondent with, per question, its
// rendered answer, its confidence and its divergence classification (FR-34's
// "confidence values and divergence classifications"). Answer text is rendered
// through the shared review formatter, so multi-line prose survives inside a
// quoted CSV cell, and the file is serialized by the pure RFC 4180 writer
// (lib/csv.ts). The divergence verdicts are computed deterministically with no
// AI (FR-31), exactly as on the comparison screen.

import { randomUUID } from "node:crypto";
import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import { classifyDivergence, type DivergenceCategory } from "./divergence";
import { listAnswersForExport, type CohortAnswerRow } from "./answers";
import type { CsvCell } from "./csv";
import { serializeCsv } from "./csv";
import { QUESTION_IDS, type QuestionId } from "./questions";
import { formatAnswerSummary } from "./review";

/** The column that carries the re-confirmed Q14(d) private note. */
export const PRIVATE_NOTE_HEADER = "q14.d (private note)";

/** One question's deterministically computed divergence category (FR-31). */
export interface ExportQuestionCategory {
  questionId: QuestionId;
  category: DivergenceCategory | "manual review" | null;
}

/**
 * The human classifier label written to the divergence column, sharing the
 * comparison screen's vocabulary so the export agrees with what is projected.
 * A closed, non-confidence question (or one nobody answered) has no category
 * and renders an empty cell rather than a made-up verdict.
 */
export function divergenceCategoryLabel(
  category: DivergenceCategory | "manual review" | null,
): string {
  switch (category) {
    case "aligned":
      return "Aligned";
    case "soft split":
      return "Soft split";
    case "hard split":
      return "Hard split";
    case "manual review":
      return "Manual review";
    default:
      return "";
  }
}

function trueish(v: string | null): boolean {
  return v === "true" || v === "1";
}

/**
 * Reconcile the export's re-confirmation. Private rows are released only when
 * the caller both requests them AND explicitly confirms: `includePrivate=true`
 * without a confirmation, or a confirmation without the request, both fall
 * through to a public export. Parsed from the query string so the decision is
 * made once, here, and the rest of the path trusts the boolean.
 */
export function includePrivateRequested(params: URLSearchParams): boolean {
  return trueish(params.get("includePrivate")) && trueish(params.get("confirmPrivate"));
}

export interface ExportRespondent {
  name: string;
  email: string | null;
  /** One per question id, keyed exactly like the schema question ids. */
  byQuestion: Map<string, CohortAnswerRow>;
}

/** Group flat cohort rows into one entry per respondent, in name order. */
export function groupExportRespondents(
  answers: readonly CohortAnswerRow[],
): ExportRespondent[] {
  const byId = new Map<string, ExportRespondent>();
  for (const a of answers) {
    let entry = byId.get(a.respondent_id);
    if (!entry) {
      entry = {
        name: a.respondent_name,
        email: a.respondent_email,
        byQuestion: new Map(),
      };
      byId.set(a.respondent_id, entry);
    }
    entry.byQuestion.set(a.question_id, a);
  }
  return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
}

/**
 * Build the full spreadsheet table (header + one data row per respondent) from
 * flat cohort rows and the per-question divergence categories. Pure: no I/O,
 * so the "no private rows by default" and "multi-line/Taglish survive" rules
 * are asserted exhaustively in unit tests without a database.
 */
export function buildExportTable(
  answers: readonly CohortAnswerRow[],
  categories: readonly ExportQuestionCategory[],
  includePrivate: boolean,
): readonly (readonly CsvCell[])[] {
  const categoryByQuestion = new Map(categories.map((c) => [c.questionId, c.category]));

  // Header: respondent identity, then per question its answer + confidence +
  // divergence, with the private note column slotting in right after q14 when
  // the re-confirmed private export is running.
  const header: CsvCell[] = ["respondent", "email"];
  for (const qid of QUESTION_IDS) {
    header.push(qid, `${qid} confidence`, `${qid} divergence`);
    if (includePrivate && qid === "q14") header.push(PRIVATE_NOTE_HEADER);
  }

  const body = groupExportRespondents(answers).map((respondent) => {
    const row: CsvCell[] = [respondent.name, respondent.email];
    for (const qid of QUESTION_IDS) {
      const ans = respondent.byQuestion.get(qid);
      row.push(
        ans ? formatAnswerSummary(qid, ans.value) : "",
        ans?.confidence ?? "",
        divergenceCategoryLabel(categoryByQuestion.get(qid) ?? null),
      );
      if (includePrivate && qid === "q14") {
        const note = respondent.byQuestion.get("q14d");
        row.push(
          note
            ? String(
                typeof note.value === "object" &&
                  note.value !== null &&
                  "private_note" in note.value
                  ? (note.value as { private_note: unknown }).private_note ?? ""
                  : "",
              )
            : "",
        );
      }
    }
    return row;
  });

  return [header, ...body];
}

/**
 * Record that a re-confirmed private export released Q14(d) rows. One row per
 * confirmed export, stamped with the acting facilitator and cohort, is the
 * audit the ticket requires (F10-T05 acceptance: "the re-confirmation path is
 * logged"). Public-only exports — which release no private row — never log.
 */
export async function logPrivateExport(
  db: ClientBase,
  cohortId: string,
  actorRespondentId: string,
): Promise<void> {
  await db.query(
    `insert into export_events (id, cohort_id, acted_by) values ($1, $2, $3)`,
    [randomUUID(), cohortId, actorRespondentId],
  );
}

/**
 * Build the CSV for the facilitator's cohort. Default excludes private rows at
 * the query layer; only `includePrivate=true` (already reconciled against the
 * explicit confirmation) includes them, and only that path is logged. Runs
 * inside the facilitator's RLS context so the cohort-wide answers are visible,
 * and computes the divergence verdicts deterministically, with no AI provider.
 */
export async function fetchExportCsv(
  db: ClientBase,
  actorRespondentId: string,
  cohortId: string,
  includePrivate: boolean,
): Promise<string> {
  return withRespondentContext(db, actorRespondentId, async (tx) => {
    const answers = await listAnswersForExport(tx, cohortId, includePrivate);

    // One deterministic category per question, from the fetched public answers.
    // (Only q14d is ever private and it is never a scored question, so grouping
    // the fetched rows already satisfies "private rows excluded from scoring".)
    const byQuestion = new Map<string, CohortAnswerRow[]>();
    for (const a of answers) {
      const list = byQuestion.get(a.question_id) ?? [];
      list.push(a);
      byQuestion.set(a.question_id, list);
    }
    const categories: ExportQuestionCategory[] = QUESTION_IDS.map((qid) => {
      const scored = byQuestion.get(qid) ?? [];
      const result = classifyDivergence(
        qid,
        scored.map((a) => ({
          value: a.value,
          confidence: a.confidence,
          is_private: false,
        })),
      );
      return { questionId: qid, category: result.category };
    });

    const table = buildExportTable(answers, categories, includePrivate);
    const csv = serializeCsv(table);

    if (includePrivate) {
      await logPrivateExport(tx, cohortId, actorRespondentId);
    }
    return csv;
  });
}