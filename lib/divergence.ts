// Deterministic divergence scoring (F10-T01, FR-31). Computed without any AI
// provider — the same discipline as `lib/validators.ts` and the OPSP mapping:
// pure functions, no I/O, no network, so it is unit-testable without a browser
// and classifies every closed question with the API key removed (PR3, the L2/L3
// fallback that makes criterion 11 and the key-removal gate true).
//
// A question is either open text (prose that cannot be compared exactly —
// flagged for manual review with word-count and length spread) or closed form
// (choice / ranking / matrix / numeric — exact agreement rate, modal answer
// and spread). Confidence-bearing closed questions get the aligned / soft
// split / hard split classification, combining answer spread with mean
// confidence per FR-31. Private rows are excluded from the scoring input here,
// in addition to being filtered at the query layer (PR / F01-T03).

import { isConfidenceQuestion } from "./confidence";
import type { QuestionId } from "./questions";
import {
  DIVERGENCE_CONFIG_DEFAULTS,
  type DivergenceConfig,
} from "./divergence-config";

/** Whether a question is scored as prose rather than exact comparison. */
export type DivergenceMode = "open" | "closed";

/** The three Part C classifications (spec.md §5.5 / FR-31). */
export type DivergenceCategory = "aligned" | "soft split" | "hard split";

export interface DivergenceAnswerInput {
  /** The question's stored value (§3.1 shape). */
  value: unknown;
  /** 1..5 where the question carries a slider (FR-11), else null. */
  confidence: number | null;
  /** True for a q14d row; excluded from all scoring input. */
  is_private: boolean;
}

export interface DivergenceResult {
  questionId: QuestionId;
  mode: DivergenceMode;
  /** Number of non-private answers actually scored. */
  included: number;
  /** Private rows dropped from the scoring input. */
  privateExcluded: number;
  /** Closed: fraction (0..1) of included answers matching the modal answer. */
  agreementRate: number | null;
  /** Closed: the most common answer signature (the consensus position). */
  modalAnswer: string | null;
  /** Closed: 1 - agreementRate; how far apart the answers are. */
  spread: number | null;
  /** Mean of set confidences over included answers, else null. */
  meanConfidence: number | null;
  /** Open: word count per included answer. */
  wordCounts: number[] | null;
  /** Open: max word count minus min word count. */
  lengthSpread: number | null;
  /**
   * Confidence-bearing closed: aligned / soft split / hard split.
   * Open text: `"manual review"`. Non-confidence closed: null.
   */
  category: DivergenceCategory | "manual review" | null;
}

/**
 * The questions scored as open text. Every §3.1 shape holding prose rather
 * than an exactly comparable choice — q6's comparison target is its `choice`,
 * q11's rocks are prose chunks and are therefore manual review. Matches the
 * seed fixture's sharp questions (q3/q8/q10) being closed and confidence-
 * bearing, so the three Part C categories land exactly there.
 */
export const OPEN_TEXT_QUESTION_IDS = [
  "q1", "q2", "q4", "q7", "q9", "q11", "q12", "q13", "q15",
] as const satisfies readonly QuestionId[];

export type OpenTextQuestionId = (typeof OPEN_TEXT_QUESTION_IDS)[number];

/** Whether a question is scored as open text (manual review) by this library. */
export function isOpenTextQuestion(id: QuestionId): boolean {
  return (OPEN_TEXT_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/** The eight closed-form questions (q3/q5/q6/q8/q10/q14). */
export const CLOSED_QUESTION_IDS = [
  "q3", "q5", "q6", "q8", "q10", "q14",
] as const satisfies readonly QuestionId[];

assertCompleteCoverage();

function assertCompleteCoverage(): void {
  const open = new Set<string>(OPEN_TEXT_QUESTION_IDS);
  const closed = new Set<string>(CLOSED_QUESTION_IDS);
  const all = new Set<string>(open);
  for (const id of CLOSED_QUESTION_IDS) all.add(id);
  if (all.size !== 15 || all.size !== open.size + closed.size) {
    // The two lists must partition every question exactly — a blank in either
    // leaves a question unscorable at runtime, so fail loudly at import.
    throw new Error("OPEN_TEXT_QUESTION_IDS and CLOSED_QUESTION_IDS must partition all fifteen questions");
  }
}

/** The exact-comparison signature for one closed-form answer. */
function signatureForQuestion(id: QuestionId, value: unknown): string {
  switch (id) {
    case "q3":
      return String((value as { unit?: unknown } | undefined)?.unit ?? "");
    case "q5": {
      const v = value as {
        pays?: unknown;
        decides?: unknown;
        uses?: unknown;
        benefits?: unknown;
      } | undefined;
      return JSON.stringify({
        pays: v?.pays ?? [],
        decides: v?.decides ?? [],
        uses: v?.uses ?? [],
        benefits: v?.benefits ?? [],
      });
    }
    case "q6":
      return String((value as { choice?: unknown } | undefined)?.choice ?? "");
    case "q8":
      return ((value as { rank?: unknown } | undefined)?.rank as unknown[] ?? [])
        .map(String)
        .join("|");
    case "q10":
      return String((value as { model?: unknown } | undefined)?.model ?? "");
    case "q14": {
      const v = value as { wants?: unknown[]; hours?: unknown } | undefined;
      const wants = [...((v?.wants ?? []) as unknown[])].map(String).sort();
      return JSON.stringify({ wants, hours: v?.hours });
    }
    default:
      return "";
  }
}

/** The prose view of one open-text answer, used for word counts. */
function proseForQuestion(id: QuestionId, value: unknown): string {
  switch (id) {
    case "q1":
    case "q4":
    case "q7":
    case "q12":
    case "q13":
    case "q15":
      return String((value as { text?: unknown } | undefined)?.text ?? "");
    case "q2": {
      const v = value as { who?: unknown; because?: unknown } | undefined;
      return `${v?.who ?? ""} ${v?.because ?? ""}`.trim();
    }
    case "q9":
      return ((value as { items?: unknown } | undefined)?.items as unknown[] ?? [])
        .map(String)
        .join(" ");
    case "q11": {
      const rocks = (value as { rocks?: unknown } | undefined)?.rocks as
        | { what?: unknown; done_when?: unknown }[]
        | undefined;
      return (rocks ?? [])
        .map((r) => `${r?.what ?? ""} ${r?.done_when ?? ""}`.trim())
        .join(" ");
    }
    default:
      return "";
  }
}

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

/**
 * Modal answer and exact agreement rate over a list of signatures. Agreement
 * is the share of answers matching the most common signature (FR-31).
 */
export function computeAgreement(
  signatures: readonly string[],
): { agreementRate: number | null; modalAnswer: string | null } {
  if (signatures.length === 0) {
    return { agreementRate: null, modalAnswer: null };
  }
  const counts = new Map<string, number>();
  let modal = signatures[0];
  let modalCount = 0;
  for (const s of signatures) {
    const c = (counts.get(s) ?? 0) + 1;
    counts.set(s, c);
    if (c > modalCount) {
      modalCount = c;
      modal = s;
    }
  }
  return { agreementRate: modalCount / signatures.length, modalAnswer: modal };
}

function meanConfidenceOf(answers: readonly DivergenceAnswerInput[]): number | null {
  const set = answers
    .map((a) => a.confidence)
    .filter((c): c is number => c !== null && c >= 1 && c <= 5);
  if (set.length === 0) return null;
  return set.reduce((sum, c) => sum + c, 0) / set.length;
}

/**
 * Score one question from every respondent's answer to it. Pure: takes the
 * answers and (optionally) the split thresholds, returns the deterministic
 * divergence result, and never touches a provider or a database. Private rows
 * are dropped from the scoring input as the first step. Thresholds default to
 * the documented config; pass a config object explicitly to tune them.
 */
export function classifyDivergence(
  questionId: QuestionId,
  answers: readonly DivergenceAnswerInput[],
  config: DivergenceConfig = DIVERGENCE_CONFIG_DEFAULTS,
): DivergenceResult {
  const publicAnswers = answers.filter((a) => !a.is_private);
  const privateExcluded = answers.length - publicAnswers.length;
  const mode: DivergenceMode = isOpenTextQuestion(questionId)
    ? "open"
    : "closed";
  const meanConfidence = meanConfidenceOf(publicAnswers);
  const base = {
    questionId,
    mode,
    included: publicAnswers.length,
    privateExcluded,
    meanConfidence,
  };

  if (mode === "open") {
    const wordCounts = publicAnswers.map((a) =>
      wordCount(proseForQuestion(questionId, a.value)),
    );
    const lengthSpread =
      wordCounts.length > 0
        ? Math.max(...wordCounts) - Math.min(...wordCounts)
        : null;
    return {
      ...base,
      agreementRate: null,
      modalAnswer: null,
      spread: null,
      wordCounts,
      lengthSpread,
      category: wordCounts.length > 0 ? "manual review" : null,
    };
  }

  const signatures = publicAnswers.map((a) =>
    signatureForQuestion(questionId, a.value),
  );
  const { agreementRate, modalAnswer } = computeAgreement(signatures);
  const spread = agreementRate === null ? null : 1 - agreementRate;

  // Classification is confidence-only (FR-31): a closed question without a
  // slider reports agreement/spread but never aligned/soft/hard.
  let category: DivergenceCategory | null = null;
  if (isConfidenceQuestion(questionId)) {
    if (spread !== null && spread > config.alignedSpreadMax) {
      category =
        meanConfidence !== null && meanConfidence >= config.hardSplitConfidenceMin
          ? "hard split"
          : "soft split";
    } else if (spread !== null) {
      category = "aligned";
    }
  }

  return {
    ...base,
    agreementRate,
    modalAnswer,
    spread,
    wordCounts: null,
    lengthSpread: null,
    category,
  };
}