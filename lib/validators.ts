// Deterministic validators (F05-T01, spec.md §7.1, tech_infrastructure.md
// §6.3). Pure functions, no I/O, no network — a validator reads only its own
// answer value and returns a Verdict. They run at every degradation level
// including L0, before any model call, so obvious problems never cost a
// token and the product keeps working with the AI key removed (PR3).
//
// A validator never inspects another respondent's answer or another of the
// same respondent's answers, so no verdict can leak a related opinion into
// the one it is judging (the uninfluenced-answers rule).
//
// The static `hint`/`example` strings a Verdict can carry are F05-T02's job
// (lib/static-hints.ts). These functions return the verdict alone; the hint is
// attached by the coach shell, not computed here.

import type { Q6Choice, QuestionId } from "./questions";
import { Q1_MIN_CHARS } from "./long-text";
import { Q6_CHOICE_LABELS } from "./single-choice-reason";
import { SHORT_TEXT_CAPS } from "./short-text";
import { isNotSureModel } from "./q10";
import { MAX_FUNCTION_CHIPS } from "./q14";

/**
 * The category of a failing answer, drawn from the coach's structured-output
 * vocabulary (tech_infrastructure.md §5.3). It groups what went wrong so the
 * coach shell and the (F13) model can both key on the same labels.
 */
export type Dimension =
  | "measurability"
  | "specificity"
  | "single_answer"
  | "too_short";

/** The outcome of evaluating one answer (tech_infrastructure.md §6.3). */
export interface Verdict {
  ok: boolean;
  /** Only present when `ok` is false (spec.md §5.3: ok carries no dimension). */
  dimension?: Dimension;
  /** Static, pre-written, matched to coach tone (populated by F05-T02). */
  hint?: string;
  /** Static, neutral-domain (populated by F05-T02). */
  example?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shape helpers. A validator receives `unknown` (the public signature), so it
// guards its record/string reads and treats a mistyped or missing field as a
// failing answer. These are the only casts in the file; the stored shapes come
// from tech_infrastructure.md §3.1.
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function textOf(v: unknown): string | null {
  return asString(asRecord(v)?.text);
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Q1 — at least 200 characters. Not coached (§6.3: wants raw voice), but the
// minimum is a §7.1 rule so the validator enforces it regardless.
// ─────────────────────────────────────────────────────────────────────────────

function validateQ1(v: unknown): Verdict {
  const text = textOf(v);
  if (text === null) return { ok: false, dimension: "too_short" };
  return text.trim().length >= Q1_MIN_CHARS
    ? { ok: true }
    : { ok: false, dimension: "too_short" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q4 — non-empty, ≤140 chars, a single sentence. The multi-sentence reading
// counts sentence terminators (`.` `!` `?`) that end a clause or the string;
// a decimal point inside "3.5" or a thousands separator in "10,000" is not
// followed by whitespace/end, so it does not count.
// ─────────────────────────────────────────────────────────────────────────────

const SENTENCE_TERMINATORS = /[.!?](?=\s|$)/g;

function sentenceCount(text: string): number {
  return (text.match(SENTENCE_TERMINATORS) ?? []).length;
}

function validateQ4(v: unknown): Verdict {
  const text = textOf(v);
  if (text === null || text.trim() === "") {
    return { ok: false, dimension: "too_short" };
  }
  const normalized = text.trim();
  if (normalized.length > SHORT_TEXT_CAPS.q4) {
    return { ok: false, dimension: "single_answer" };
  }
  return sentenceCount(normalized) > 1
    ? { ok: false, dimension: "single_answer" }
    : { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q3 — metric name non-empty; value parses as a number; unit non-empty. The
// stored value is already a number, so "parses as a number" is a finite-number
// check; the `why` field is intentionally not judged (the §7.1 rule does not
// ask for it).
// ─────────────────────────────────────────────────────────────────────────────

function validateQ3(v: unknown): Verdict {
  const rec = asRecord(v);
  if (rec === null) return { ok: false, dimension: "measurability" };
  const metric = asString(rec.metric);
  const unit = asString(rec.unit);
  const metricOk = metric !== null && metric.trim() !== "";
  const unitOk = unit !== null && unit.trim() !== "";
  const valueOk = typeof rec.value === "number" && Number.isFinite(rec.value);
  return metricOk && unitOk && valueOk
    ? { ok: true }
    : { ok: false, dimension: "measurability" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q6 — reason non-empty, ≥8 words, and not a restatement of the chosen party.
// A restatement is a reason that mentions the chosen side and then says
// nothing new: after removing the choice label and ordinary filler words, no
// substantive word remains.
// ─────────────────────────────────────────────────────────────────────────────

const Q6_RESTATEMENT_STOPWORDS = new Set([
  "a", "an", "the", "because", "to", "with", "for", "of", "on", "in", "at",
  "from", "by", "we", "i", "you", "our", "us", "me", "my", "your", "should",
  "would", "could", "will", "can", "is", "are", "am", "be", "was", "were",
  "been", "being", "do", "does", "did", "have", "has", "had", "go", "goes",
  "going", "choose", "chooses", "chosen", "chose", "pick", "picks", "picked",
  "picking", "side", "sides", "that", "this", "these", "those", "it", "its",
  "them", "they", "their", "there", "over", "instead", "but", "or", "and",
  "so", "then", "right", "wrong", "best", "better", "more", "most", "now",
  "sure", "definitely", "obviously", "clearly", "main", "always", "just",
  "really", "only", "also", "about", "around", "get", "say", "said", "mean",
  "think", "believe", "feel", "one", "all", "every",
]);

function isQ6Restatement(reason: string, choice: string): boolean {
  const label = Q6_CHOICE_LABELS[choice as Q6Choice]?.toLowerCase();
  if (label === undefined) return false;
  const lowered = reason.toLowerCase();
  if (!lowered.includes(label)) return false;
  const substantive = lowered
    .replaceAll(label, " ")
    .split(/[^a-z]+/)
    .filter((token) => token.length > 0 && !Q6_RESTATEMENT_STOPWORDS.has(token));
  return substantive.length === 0;
}

function validateQ6(v: unknown): Verdict {
  const rec = asRecord(v);
  const why = rec === null ? null : asString(rec.why);
  const choice = rec === null ? null : asString(rec.choice);
  if (why === null || choice === null) {
    return { ok: false, dimension: "single_answer" };
  }
  const reason = why.trim();
  if (reason === "") return { ok: false, dimension: "too_short" };
  if (wordCount(reason) < 8) return { ok: false, dimension: "too_short" };
  if (isQ6Restatement(reason, choice)) {
    return { ok: false, dimension: "single_answer" };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q7 — non-empty, ≤120 chars, at most one conjunction. Words are matched on
// word boundaries so "understand" is not read as an "and"; more than one
// conjunction reads as a feature list, which is what §6.3 is checking for.
// ─────────────────────────────────────────────────────────────────────────────

const Q7_CONJUNCTIONS: readonly RegExp[] = [
  /\band\b/gi,
  /\bor\b/gi,
  /\bbut\b/gi,
  /\balso\b/gi,
  /\bplus\b/gi,
  /\bas well as\b/gi,
  /[&+]/g,
];

function conjunctionCount(text: string): number {
  return Q7_CONJUNCTIONS.reduce(
    (sum, re) => sum + (text.match(re) ?? []).length,
    0,
  );
}

function validateQ7(v: unknown): Verdict {
  const text = textOf(v);
  if (text === null || text.trim() === "") {
    return { ok: false, dimension: "too_short" };
  }
  const normalized = text.trim();
  if (normalized.length > SHORT_TEXT_CAPS.q7) {
    return { ok: false, dimension: "single_answer" };
  }
  return conjunctionCount(normalized) > 1
    ? { ok: false, dimension: "single_answer" }
    : { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q9 — all three fields non-empty, each at least 4 words. Three separate,
// substantive refusals (baseline Q9: "Name three things").
// ─────────────────────────────────────────────────────────────────────────────

function validateQ9(v: unknown): Verdict {
  const rec = asRecord(v);
  const items = rec === null ? null : rec.items;
  if (!Array.isArray(items) || items.length !== 3) {
    return { ok: false, dimension: "specificity" };
  }
  const allValid = items.every((item) => {
    const s = asString(item);
    if (s === null) return false;
    const t = s.trim();
    return t !== "" && wordCount(t) >= 4;
  });
  return allValid ? { ok: true } : { ok: false, dimension: "specificity" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q10 — all four parts present; first_peso a future month. "not sure yet" on
// the model short-circuits the whole question (spec/README resolved conflict,
// F05-T01 note): it is a complete, honest answer, so no amount and no month
// are demanded, even when the date is unset.
// ─────────────────────────────────────────────────────────────────────────────

function isFutureMonth(yearMonth: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return false;
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  return year > nowYear || (year === nowYear && month > nowMonth);
}

function validateQ10(v: unknown): Verdict {
  const rec = asRecord(v);
  if (rec === null) return { ok: false, dimension: "specificity" };
  const model = asString(rec.model);
  if (model === null) return { ok: false, dimension: "specificity" };
  if (isNotSureModel(model)) return { ok: true };
  const payer = rec.payer;
  const payerOk = Array.isArray(payer)
    ? payer.length > 0 && payer.every((p) => typeof p === "string" && p.trim() !== "")
    : typeof payer === "string" && payer.trim() !== "";
  const modelOk = model.trim() !== "";
  const amountOk = typeof rec.amount === "number" && Number.isFinite(rec.amount);
  const firstPeso = asString(rec.first_peso);
  const firstPesoOk = firstPeso !== null && isFutureMonth(firstPeso);
  const ok = payerOk && modelOk && amountOk && firstPesoOk;
  return ok ? { ok: true } : { ok: false, dimension: "specificity" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q11 — each done-condition verifiable: contains a digit, a date, or a
// countable noun, and is not solely a vague verb. "level up" is normalised so
// it reads as one vague verb. Highly generic process nouns (onboarding,
// growth, efficiency, ...) are not something you could point at, so they do
// not satisfy the countable-noun clause — "improve onboarding" is exactly the
// unverifiable condition the question is built to catch.
// ─────────────────────────────────────────────────────────────────────────────

const VAGUE_VERBS = new Set([
  "improve", "improving", "enhance", "enhancing", "optimise", "optimize",
  "optimizing", "streamline", "streamlining", "better", "strengthen",
  "strengthening", "polish", "polishing", "levelup",
]);

const ABSTRACT_PROCESS_WORDS = new Set([
  "onboarding", "improvement", "improvements", "growth", "engagement",
  "visibility", "efficiency", "workflow", "process", "processes", "momentum",
  "traction", "brand", "mindshare", "culture", "alignment", "adoption",
  "retention", "awareness", "recognition", "trust", "friction", "velocity",
  "speed", "quality", "training", "experience", "ecosystem", "journey",
  "execution", "scale", "scaling", "expansion",
]);

const FILLER_WORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "with", "and",
  "or", "but", "yet", "before", "after", "until", "from", "into", "over",
  "under", "so", "we", "i", "our", "us", "it", "its", "all", "can", "will",
  "should", "make", "made", "get", "got", "do", "did", "does", "be",
  "is", "are", "am", "was", "been", "have", "has", "had", "that", "this",
  "these", "those", "which", "who", "whom", "not", "only", "also", "then",
  "there", "their", "them", "they", "its", "up", "out", "as", "per", "down",
  "each", "every", "when", "where", "how", "what", "need", "needs",
]);

const MONTH_NAME = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const NUMERIC_DATE = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/;

function hasDate(text: string): boolean {
  return MONTH_NAME.test(text) || NUMERIC_DATE.test(text);
}

/**
 * Whether a done-condition is verifiable. A number or a date satisfies it
 * outright; otherwise the condition must name at least one countable,
 * pointable noun (a substantive token that is not filler, not a vague verb and
 * not a generic process noun).
 */
export function isVerifiableDoneCondition(doneWhen: string): boolean {
  if (/\d/.test(doneWhen)) return true;
  if (hasDate(doneWhen)) return true;
  const normalized = doneWhen.toLowerCase().replace(/\blevel[- ]up\b/g, "levelup");
  const tokens = normalized.split(/[^a-z]+/).filter((t) => t.length > 0);
  return tokens.some(
    (t) =>
      !FILLER_WORDS.has(t) &&
      !VAGUE_VERBS.has(t) &&
      !ABSTRACT_PROCESS_WORDS.has(t),
  );
}

function validateQ11(v: unknown): Verdict {
  const rec = asRecord(v);
  const rocks = rec === null ? null : rec.rocks;
  if (!Array.isArray(rocks) || rocks.length === 0) {
    return { ok: false, dimension: "measurability" };
  }
  for (const rockValue of rocks) {
    const rock = asRecord(rockValue);
    if (rock === null) continue;
    const what = asString(rock.what);
    const doneWhen = asString(rock.done_when);
    const started =
      (what !== null && what.trim() !== "") ||
      (doneWhen !== null && doneWhen.trim() !== "");
    if (!started) continue; // an untouched optional block passes
    const condition = (doneWhen ?? "").trim();
    if (condition === "" || !isVerifiableDoneCondition(condition)) {
      return { ok: false, dimension: "measurability" };
    }
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q12 — ≤40 chars, ≥2 words. Short by design (§6.3), so the only failures are
// an over-long name or a single unintelligible word.
// ─────────────────────────────────────────────────────────────────────────────

function validateQ12(v: unknown): Verdict {
  const text = textOf(v);
  if (text === null || text.trim() === "") {
    return { ok: false, dimension: "too_short" };
  }
  const normalized = text.trim();
  if (normalized.length > SHORT_TEXT_CAPS.q12) {
    return { ok: false, dimension: "single_answer" };
  }
  return wordCount(normalized) < 2
    ? { ok: false, dimension: "too_short" }
    : { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Q14 — at most 3 functions selected; hours between 0 and 60. Structurally
// constrained (§6.3, not coached), but the boundary rules are still §7.1 rules
// a validator must enforce.
// ─────────────────────────────────────────────────────────────────────────────

function validateQ14(v: unknown): Verdict {
  const rec = asRecord(v);
  if (rec === null) return { ok: false, dimension: "single_answer" };
  const wantsOk = Array.isArray(rec.wants) && rec.wants.length <= MAX_FUNCTION_CHIPS;
  const hours = rec.hours;
  const hoursOk =
    typeof hours === "number" && Number.isFinite(hours) && hours >= 0 && hours <= 60;
  return wantsOk && hoursOk
    ? { ok: true }
    : { ok: false, dimension: "single_answer" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Questions 2, 5, 8, 13 and 15 are not coached (§6.3) and carry no §7.1 rule,
// so their validators always accept. They are kept in the record because the
// public type is total — every QuestionId has a validator — and so a caller
// can run the validators at every level without branching on which question
// the coach covers.
// ─────────────────────────────────────────────────────────────────────────────

const ALWAYS_PASS: (v: unknown) => Verdict = () => ({ ok: true });

/** One deterministic validator per question (tech_infrastructure.md §6.3). */
export const validators: Record<QuestionId, (v: unknown) => Verdict> = {
  q1: validateQ1,
  q2: ALWAYS_PASS,
  q3: validateQ3,
  q4: validateQ4,
  q5: ALWAYS_PASS,
  q6: validateQ6,
  q7: validateQ7,
  q8: ALWAYS_PASS,
  q9: validateQ9,
  q10: validateQ10,
  q11: validateQ11,
  q12: validateQ12,
  q13: ALWAYS_PASS,
  q14: validateQ14,
  q15: ALWAYS_PASS,
};