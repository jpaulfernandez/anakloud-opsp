import {
  QUESTION_IDS,
  QUESTION_MAP,
  type QuestionId,
} from "./questions";
import { APP_LABELS } from "./ranking";
import { Q5_COLUMNS, Q5_COLUMN_LABELS, Q5_ROLE_LABELS } from "./matrix-grid";
import { FUNCTION_LABELS } from "./q14";
import { Q6_CHOICE_LABELS } from "./single-choice-reason";

// Review screen model and formatting (F06-T01, FR-13, ui_ux.md §4.12).
//
// Pure, no I/O, no network — the same discipline as the validators and the
// navigation module, so the completion rules and the per-question summaries
// are deterministic and unit-testable. The review presents all fifteen
// questions collapsed to answer summaries, each with an edit link back to the
// question and then to review (F06-T01); optional questions the respondent
// skipped are listed separately under verbatim ui_ux §4.12 copy. The submit
// button is secondary-styled until every required question is answered — the
// button itself and its confirmation are later tickets, but the *styling
// decision* is this module's compass: it is derived from the same
// `allRequiredQuestionsAnswered` helper here.
//
// The model is built from the respondent's own answer rows (listOwnAnswers),
// which is the one read path that includes the owner's own q14d private row
// (F01-T03). The private note is split out and surfaced on its own screen as a
// distinct block, exactly because showing "the respondent's own Q14(d)
// content" is a requirement of this ticket while every export still excludes
// it at the query layer.

/** One of the caller's own answer rows, as the review model needs it. */
export interface ReviewAnswerRow {
  question_id: string;
  value: unknown;
  confidence: number | null;
  is_private: boolean;
}

/** Per-question view of state, in registry order. */
export interface ReviewQuestion {
  id: QuestionId;
  /** Whether a stored answer row exists for this question id. */
  answered: boolean;
  required: boolean;
  /** The stored §3.1 public value (for q14, the public fields). */
  value: unknown;
  confidence: number | null;
  /** q14's own private note, non-empty only for the q14 slide. */
  privateNote: string | null;
}

/** Maps a cohort mate's respondent id to their display name for q14(b). */
export type DisplayNameResolver = (respondentId: string) => string | undefined;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Assemble the fifteen-question review model from the responder's own answer
 * rows. Rows are keyed by question_id; q14's private note lives in its own
 * q14d row (F01-T03), so it is read separately and re-attached to q14 here,
 * and only as the responder's own screen (the private exclude rule is enforced
 * in the SQL that produces the rows — no export path feeds this).
 */
export function buildReviewModel(
  rows: readonly ReviewAnswerRow[],
): ReviewQuestion[] {
  const byId = new Map<string, ReviewAnswerRow>();
  for (const row of rows) byId.set(row.question_id, row);

  const q14d = rows.find((row) => row.question_id === "q14d");
  const note = q14d ? String(asRecord(q14d.value).private_note ?? "") : "";

  return QUESTION_IDS.map((id) => {
    const row = byId.get(id);
    return {
      id,
      answered: row !== undefined,
      required: QUESTION_MAP[id].required,
      value: row?.value ?? null,
      confidence: row?.confidence ?? null,
      // Only a non-empty note couples to q14; a blank private field stays off.
      privateNote: id === "q14" && note !== "" ? note : null,
    };
  });
}

/**
 * Whether every required question holds an answer. Drives the submit button's
 * secondary styling: secondary until complete, primary once complete
 * (F06-T01 acceptance). `answered` is the set of question ids holding an
 * answer row.
 */
export function allRequiredQuestionsAnswered(
  answered: ReadonlySet<QuestionId>,
): boolean {
  return QUESTION_IDS.every((id) => !QUESTION_MAP[id].required || answered.has(id));
}

/** The optional questions with no answer, to list under the "skipped" heading. */
export function skippedOptionalQuestions(
  answered: ReadonlySet<QuestionId>,
): QuestionId[] {
  return QUESTION_IDS.filter((id) => !QUESTION_MAP[id].required && !answered.has(id));
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function display(labels: Record<string, string>, id: string): string {
  return labels[id] ?? id;
}

/**
 * A collapsed, human-readable summary of a stored answer. One question's
 * summary is a short string (newline-separated for composite answers); the
 * review screen renders it read-only under the question's text. Confidence is
 * not folded in here — it is its own column and the card shows it separately —
 * and q14's private note is handled by the screen because it arrives from a
 * separate row.
 */
export function formatAnswerSummary(
  id: QuestionId,
  value: unknown,
  nameOf?: DisplayNameResolver,
): string {
  const v = asRecord(value);
  switch (id) {
    case "q1":
    case "q4":
    case "q7":
    case "q12":
    case "q15":
      return String(v.text ?? "");
    case "q2":
      return `The people who would miss it most are ${String(v.who ?? "")}, because ${String(v.because ?? "")}.`;
    case "q3": {
      const number = v.value;
      return `${String(v.metric ?? "")}: ${typeof number === "number" ? number : ""} ${String(v.unit ?? "")}${
        String(v.why ?? "") !== "" ? ` — ${String(v.why)}` : ""
      }`;
    }
    case "q5":
      return Q5_COLUMNS.map((col) => {
        const ids = strings(v[col]);
        const listed = ids.length
          ? ids.map((rol) => (Q5_ROLE_LABELS as Record<string, string>)[rol] ?? rol).join(", ")
          : "None";
        return `${Q5_COLUMN_LABELS[col]}: ${listed}`;
      }).join("\n");
    case "q6":
      return `${display(Q6_CHOICE_LABELS, String(v.choice ?? ""))} — ${String(v.why ?? "")}`;
    case "q8": {
      const rank = strings(v.rank);
      const predicted = strings(v.predicted);
      const lines = rank.map(
        (app, i) => `${i + 1}. ${display(APP_LABELS, app)}`,
      );
      const remove = String(v.delete ?? "");
      if (remove !== "") lines.push(`Would delete: ${display(APP_LABELS, remove)}`);
      if (String(v.why ?? "") !== "") lines.push(`Why: ${String(v.why)}`);
      if (predicted.length > 0) {
        lines.push(`Predicted group #1: ${display(APP_LABELS, predicted[0])}`);
      }
      return lines.join("\n");
    }
    case "q9":
      return strings(v.items)
        .map((item, i) => `${i + 1}. ${item}`)
        .join("\n");
    case "q10": {
      const amount = v.amount;
      const payerDisplay = Array.isArray(v.payer)
        ? v.payer.join(", ")
        : String(v.payer ?? "");
      return [
        `Payer: ${payerDisplay}`,
        `Model: ${String(v.model ?? "")}`,
        `Pays: ${typeof amount === "number" ? amount : ""} ${String(v.unit ?? "")}`,
        `First real peso: ${String(v.first_peso ?? "")}`,
      ]
        .filter((line) => line.split(": ")[1] !== "")
        .join("\n");
    }
    case "q11": {
      const rocks = Array.isArray(v.rocks) ? (v.rocks as Record<string, unknown>[]) : [];
      const starred = typeof v.starred === "number" ? v.starred : null;
      const lines = rocks.map((rock, i) => {
        const mark = starred === i ? "★ " : "";
        return `${mark}${i + 1}. ${String(rock.what ?? "")} — done when: ${String(rock.done_when ?? "")}`;
      });
      return lines.join("\n");
    }
    case "q13":
      return [String(v.text ?? ""), `Most likely cause: ${String(v.cause ?? "")}`]
        .filter((line) => line !== "Most likely cause: " && line !== "")
        .join("\n");
    case "q14": {
      const wants = strings(v.wants).map((fn) => display(FUNCTION_LABELS, fn));
      const lines: string[] = [
        `Wants to own: ${wants.length > 0 ? wants.join(", ") : "none"}`,
      ];
      const others = asRecordAsRecordStringMap(v.others);
      const othersKeys = Object.keys(others);
      if (othersKeys.length > 0) {
        lines.push("Thinks others own:");
        for (const rid of othersKeys) {
          const fn = others[rid];
          if (fn === undefined) continue;
          lines.push(`  ${nameOf ? (nameOf(rid) ?? rid) : rid}: ${display(FUNCTION_LABELS, fn)}`);
        }
      }
      const hours = v.hours;
      lines.push(`Hours a week: ${typeof hours === "number" ? hours : ""}`);
      return lines.join("\n");
    }
    default:
      return "";
  }
}

function asRecordAsRecordStringMap(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  const result: Record<string, string> = {};
  for (const key of Object.keys(rec)) {
    if (typeof rec[key] === "string") result[key] = rec[key] as string;
  }
  return result;
}