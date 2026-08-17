import type { QuestionId } from "./questions";
import { QUESTION_IDS } from "./questions";

// Answer payload shape validation (F04-T01, tech_infrastructure.md §3.1, §4).
//
// The answers API must validate the payload shape against the question
// registry before writing. This module is that check, and it is deliberately
// pure: no I/O, no network, so it is exhaustively unit-testable and so the
// route cannot write a structurally wrong answer. It validates *shape* only —
// every key present with the right type, per §3.1. Semantic rules (non-empty
// fields, char caps, ≤3 functions, hours 0–60) are F05's job in
// lib/validators.ts.
//
// The one place this also enforces a boundary rule is reader-side too: a
// `respondent_id` sent by the client is never read. parseAnswerWriteBody
// extracts exactly question_id, value and confidence, so "SHALL NOT accept a
// respondent_id supplied by the client" holds by there being nowhere for it to
// enter — the session cookie is the only identity source, in the route.

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every(isString);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

const QUESTION_ID_SET = new Set<string>(QUESTION_IDS);

/** True when `v` is one of the fifteen stable question ids (q1..q15). */
export function isQuestionId(v: unknown): v is QuestionId {
  return typeof v === "string" && QUESTION_ID_SET.has(v);
}

/**
 * True when `value` matches the §3.1 shape for `id`. Structural only: required
 * keys present, each with the right type. Unknown keys are tolerated (the
 * write path stores the whole object), but a missing or mistyped required key
 * is rejected, which is what "a payload of the wrong shape is rejected with
 * 400" demands.
 */
export function isValidAnswerShape(id: QuestionId, value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (id) {
    case "q1":
    case "q4":
    case "q7":
    case "q12":
    case "q15":
      // { text: string }
      return "text" in value && isString(value.text);
    case "q13":
      // { text: string; cause: Q13Cause }
      return (
        "text" in value &&
        isString(value.text) &&
        "cause" in value &&
        isString(value.cause)
      );
    case "q2":
      // { who: string; because: string }
      return "who" in value && isString(value.who) && "because" in value && isString(value.because);
    case "q3":
      // { metric: string; value: number; unit: string; why: string }
      return (
        "metric" in value &&
        isString(value.metric) &&
        "value" in value &&
        isFiniteNumber(value.value) &&
        "unit" in value &&
        isString(value.unit) &&
        "why" in value &&
        isString(value.why)
      );
    case "q5":
      // { pays: Role[]; decides: Role[]; uses: Role[]; benefits: Role[] }
      return (
        "pays" in value &&
        isStringArray(value.pays) &&
        "decides" in value &&
        isStringArray(value.decides) &&
        "uses" in value &&
        isStringArray(value.uses) &&
        "benefits" in value &&
        isStringArray(value.benefits)
      );
    case "q6":
      // { choice: string; why: string }
      return "choice" in value && isString(value.choice) && "why" in value && isString(value.why);
    case "q8":
      // { rank: AppId[]; delete: AppId; why: string; predicted: AppId[] }
      return (
        "rank" in value &&
        isStringArray(value.rank) &&
        "delete" in value &&
        isString(value.delete) &&
        "why" in value &&
        isString(value.why) &&
        "predicted" in value &&
        isStringArray(value.predicted)
      );
    case "q9":
      // { items: [string, string, string] }
      return (
        Array.isArray(value.items) &&
        value.items.length === 3 &&
        value.items.every(isString)
      );
    case "q10":
      // { payer: string | string[]; model: string; amount: number; unit: string; first_peso: string }
      return (
        "payer" in value &&
        (isString(value.payer) ||
          (Array.isArray(value.payer) && value.payer.every(isString))) &&
        "model" in value &&
        isString(value.model) &&
        "amount" in value &&
        isFiniteNumber(value.amount) &&
        "unit" in value &&
        isString(value.unit) &&
        "first_peso" in value &&
        isString(value.first_peso)
      );
    case "q11":
      // { rocks: {what:string; done_when:string}[]; starred: 0|1|2 }
      return (
        Array.isArray(value.rocks) &&
        value.rocks.every(
          (r) =>
            isRecord(r) && "what" in r && isString(r.what) && "done_when" in r && isString(r.done_when),
        ) &&
        (value.starred === 0 || value.starred === 1 || value.starred === 2)
      );
    case "q14":
      // { wants: FunctionId[]; others: Record<respondentId, FunctionId>;
      //   hours: number; private_note: string }
      return (
        "wants" in value &&
        isStringArray(value.wants) &&
        "others" in value &&
        isRecord(value.others) &&
        Object.values(value.others).every(isString) &&
        "hours" in value &&
        isFiniteNumber(value.hours) &&
        "private_note" in value &&
        isString(value.private_note)
      );
    default:
      return false;
  }
}

/** A structurally valid write request, ready to persist. */
export interface ParsedAnswerWrite {
  questionId: QuestionId;
  value: unknown;
  confidence: number | null;
}

/**
 * Parse and validate the PATCH /api/answers body. Reads exactly question_id,
 * value and confidence — a `respondent_id` in the body is ignored by
 * construction. Returns null for a body that is not a JSON object, an unknown
 * question id, a payload that fails the §3.1 shape check, or a confidence that
 * is present but not an integer 1..5 (the only values a confidence slider can
 * produce, per FR-11).
 */
export function parseAnswerWriteBody(body: unknown): ParsedAnswerWrite | null {
  if (!isRecord(body)) return null;
  const questionId = body.question_id;
  if (!isQuestionId(questionId)) return null;
  if (!("value" in body)) return null;
  if (!isValidAnswerShape(questionId, body.value)) return null;

  let confidence: number | null = null;
  if (body.confidence !== undefined && body.confidence !== null) {
    const c = body.confidence;
    if (typeof c !== "number" || !Number.isInteger(c) || c < 1 || c > 5) {
      return null;
    }
    confidence = c;
  }

  return { questionId, value: body.value, confidence };
}