// The question registry — one typed source of truth for all fifteen questions
// (F01-T07). Everything downstream reads from here: F03 renders each question
// from `inputTypes`, F05 validates from the value types, F07 maps answers to
// OPSP cells, F10 clamps divergence scoring to the confidence-bearing set, and
// F13 decides whether the coach runs at all from `coachable`.
//
// Source precedence follows spec/README.md: question wording, sections and
// helper text come from anakloud-baseline-questions.md Part A; the coached /
// not-coached split comes from spec.md §6.3 (FR-21); the confidence set from
// FR-11; the answer value shapes from tech_infrastructure.md §3.1.

export const QUESTION_IDS = [
  "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10",
  "q11", "q12", "q13", "q14", "q15",
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

/**
 * The input components a question renders, one per FR-10 type. Four of the
 * twelve appear only as constituents of a composite screen (Q8's ranking, the
 * month picker in Q10, the hours slider in Q14, the confidence slider on six
 * questions), so a question carries the *list* of controls it renders rather
 * than a single primary.
 */
export type QuestionInputType =
  | "long_text"
  | "sentence_completion"
  | "metric_triple"
  | "short_text" // hard character cap
  | "matrix_grid"
  | "ranking" // 4 items, tap-to-assign
  | "single_choice_reason"
  | "paired_rows_star"
  | "numeric_slider"
  | "capped_multi_select"
  | "confidence_slider" // 1–5
  | "month_picker";

/** Every input type named in FR-10, in that requirement's order. */
export const FR10_INPUT_TYPES: readonly QuestionInputType[] = [
  "long_text",
  "sentence_completion",
  "metric_triple",
  "short_text",
  "matrix_grid",
  "ranking",
  "single_choice_reason",
  "paired_rows_star",
  "numeric_slider",
  "capped_multi_select",
  "confidence_slider",
  "month_picker",
];

// Stable vocabularies behind the §3.1 value shapes. These are the same ids the
// seed fixture and F03 control components key on; question_id values never
// change, and neither do these.
export const APP_IDS = ["pedconnect", "pedmd", "parentup", "teachday"] as const;
export type AppId = (typeof APP_IDS)[number];

/**
 * The three questions that render the long-text input (q1/q13/q15). A type
 * guard so the F03 shell can narrow a QuestionId to these before mounting the
 * long-text component, keeping the component's props precisely typed.
 */
export const LONG_TEXT_QUESTION_IDS = ["q1", "q13", "q15"] as const;
export type LongTextQuestionId = (typeof LONG_TEXT_QUESTION_IDS)[number];
export function isLongTextQuestion(id: QuestionId): id is LongTextQuestionId {
  return (LONG_TEXT_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the sentence-completion input (Q2, F03-T03). A
 * type guard so the F03 shell can narrow a QuestionId before mounting the
 * component, keeping its props precisely typed — the same pattern as the
 * long-text guard above.
 */
export const SENTENCE_COMPLETION_QUESTION_IDS = ["q2"] as const;
export type SentenceCompletionQuestionId = (typeof SENTENCE_COMPLETION_QUESTION_IDS)[number];
export function isSentenceCompletionQuestion(
  id: QuestionId,
): id is SentenceCompletionQuestionId {
  return (SENTENCE_COMPLETION_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the metric-triple input (Q3, F03-T04). A type
 * guard so the F03 shell can narrow a QuestionId before mounting the
 * component, exactly like the long-text and sentence-completion guards above.
 */
export const METRIC_TRIPLE_QUESTION_IDS = ["q3"] as const;
export type MetricTripleQuestionId = (typeof METRIC_TRIPLE_QUESTION_IDS)[number];
export function isMetricTripleQuestion(
  id: QuestionId,
): id is MetricTripleQuestionId {
  return (METRIC_TRIPLE_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the matrix-grid input (Q5, F03-T05). A type guard
 * so the F03 shell can narrow a QuestionId before mounting the component — the
 * same pattern as the other input guards above.
 */
export const MATRIX_GRID_QUESTION_IDS = ["q5"] as const;
export type MatrixGridQuestionId = (typeof MATRIX_GRID_QUESTION_IDS)[number];
export function isMatrixGridQuestion(
  id: QuestionId,
): id is MatrixGridQuestionId {
  return (MATRIX_GRID_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the single-choice + required-reason input (Q6,
 * F03-T06). A type guard so the F03 shell can narrow a QuestionId before
 * mounting the component — the same pattern as the other input guards above.
 */
export const SINGLE_CHOICE_REASON_QUESTION_IDS = ["q6"] as const;
export type SingleChoiceReasonQuestionId = (typeof SINGLE_CHOICE_REASON_QUESTION_IDS)[number];
export function isSingleChoiceReasonQuestion(
  id: QuestionId,
): id is SingleChoiceReasonQuestionId {
  return (SINGLE_CHOICE_REASON_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the tap-to-assign ranking input (Q8, F03-T07). A
 * type guard so the F03 shell can narrow a QuestionId before mounting the
 * component — the same pattern as the other input guards above.
 */
export const RANKING_QUESTION_IDS = ["q8"] as const;
export type RankingQuestionId = (typeof RANKING_QUESTION_IDS)[number];
export function isRankingQuestion(
  id: QuestionId,
): id is RankingQuestionId {
  return (RANKING_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the paired-rows + star input (Q11, F03-T08). A
 * type guard so the F03 shell can narrow a QuestionId before mounting the
 * component — the same pattern as the other input guards above.
 */
export const PAIRED_ROWS_QUESTION_IDS = ["q11"] as const;
export type PairedRowsQuestionId = (typeof PAIRED_ROWS_QUESTION_IDS)[number];
export function isPairedRowsQuestion(
  id: QuestionId,
): id is PairedRowsQuestionId {
  return (PAIRED_ROWS_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the capped multi-select + hours slider + private
 * field input (Q14, F03-T09). A type guard so the F03 shell can narrow a
 * QuestionId before mounting the component — the same pattern as the other
 * input guards above.
 */
export const Q14_QUESTION_IDS = ["q14"] as const;
export type Q14QuestionId = (typeof Q14_QUESTION_IDS)[number];
export function isQ14Question(
  id: QuestionId,
): id is Q14QuestionId {
  return (Q14_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The three questions rendered with a capped short-text input (Q4/Q7/Q12,
 * F03-T10). A type guard so the F03 shell can narrow a QuestionId before
 * mounting the component — the same pattern as the other input guards above.
 * Q9 is deliberately *not* here: it stores three short strings rather than
 * one, so it has its own guard and component below.
 */
export const CAPPED_SHORT_TEXT_QUESTION_IDS = ["q4", "q7", "q12"] as const;
export type CappedShortTextQuestionId =
  (typeof CAPPED_SHORT_TEXT_QUESTION_IDS)[number];
export function isCappedShortTextQuestion(
  id: QuestionId,
): id is CappedShortTextQuestionId {
  return (CAPPED_SHORT_TEXT_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the three-short-fields input (Q9, F03-T10). A
 * type guard so the F03 shell can narrow a QuestionId before mounting the
 * component — the same pattern as the other input guards above.
 */
export const Q9_QUESTION_IDS = ["q9"] as const;
export type Q9QuestionId = (typeof Q9_QUESTION_IDS)[number];
export function isQ9Question(
  id: QuestionId,
): id is Q9QuestionId {
  return (Q9_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

/**
 * The question rendered with the four-part money input (Q10, F03-T10). A type
 * guard so the F03 shell can narrow a QuestionId before mounting the
 * component — the same pattern as the other input guards above.
 */
export const Q10_QUESTION_IDS = ["q10"] as const;
export type Q10QuestionId = (typeof Q10_QUESTION_IDS)[number];
export function isQ10Question(
  id: QuestionId,
): id is Q10QuestionId {
  return (Q10_QUESTION_IDS as readonly QuestionId[]).includes(id);
}

export const Q5_ROLE_IDS = [
  "pediatrician", "center_owner", "occupational_therapist",
  "speech_pathologist", "parent", "school_sped", "child", "lgu_doh",
  "hmo_insurer",
] as const;
export type RoleId = (typeof Q5_ROLE_IDS)[number];

export const Q6_CHOICES = ["center", "parent", "pedia", "therapist"] as const;
export type Q6Choice = (typeof Q6_CHOICES)[number];

/**
 * Q10(a) payer options (baseline Part A Q10 / F03-T10). Written verbatim: the
 * stored `payer` value IS the display string — there is no separate id→label
 * map, because Q10's single choices are written to the payload exactly as the
 * baseline words them. This is unlike Q6/Q13, which key on short ids.
 */
export const Q10_PAYER_OPTIONS = [
  "center",
  "parent",
  "pediatrician/clinic",
  "school",
  "LGU/DOH",
  "HMO",
  "other",
] as const;
export type Q10PayerOption = (typeof Q10_PAYER_OPTIONS)[number];

/**
 * Q10(b) model options (baseline Part A Q10 / F03-T10). Written verbatim. The
 * stored `model` value IS the display string, exactly like the payer options.
 * "not sure yet" is deliberately one of them: picking it is a complete, valid
 * answer to Q10(b) that must not be penalised in validation or coaching
 * (F03-T10, spec.md §7.1 Q10).
 */
export const Q10_MODEL_OPTIONS = [
  "monthly subscription per center",
  "per-seat/per-therapist",
  "per active child per month",
  "per session fee",
  "freemium with parent upgrade",
  "commission on referrals",
  "grant or institutional funding",
  "not sure yet",
] as const;
export type Q10ModelOption = (typeof Q10_MODEL_OPTIONS)[number];

/** The exact string of the "I don't know the model yet" option on Q10(b). */
export const Q10_NOT_SURE_MODEL = "not sure yet" as const;

/**
 * The single-choice cause on Q13 (baseline Part A Q13). Written verbatim from
 * the baseline list and rendered below the textarea (F03-T02). The selected
 * cause feeds the OPSP SWT — Threats cell (Part B), so it is stored alongside
 * the long text as `{ text, cause }` rather than discarded.
 */
export const Q13_CAUSES = [
  "centers wouldn't change their workflow",
  "doctors wouldn't refer through us",
  "ran out of money",
  "the team drifted apart",
  "data privacy or regulatory problem",
  "a competitor got there first",
  "product too complex to onboard",
  "we never picked one thing",
  "other",
] as const;
export type Q13Cause = (typeof Q13_CAUSES)[number];

export const FUNCTION_IDS = [
  "product", "backend", "mobile_web", "qa", "design_ux",
  "data_privacy_security", "clinical_relations", "sales_partner",
  "doctor_relations", "onboarding_success", "support", "marketing",
  "finance", "fundraising", "legal_ip", "hiring",
] as const;
export type FunctionId = (typeof FUNCTION_IDS)[number];

export interface QuestionDefinition {
  /** Stable, q1..q15. Never changes across content revisions. */
  id: QuestionId;
  /** Quiet section label (baseline Part A section headings). */
  section: string;
  /** The question text shown large (baseline Part A headings). */
  text: string;
  /** Helper text shown below the question (baseline interaction / ui_ux copy). */
  helper: string;
  /**
   * The FR-10 input components this question renders. Every one of the twelve
   * FR-10 types appears in at least one entry here, so the F03 renderer is
   * guaranteed to build each component against a real question. The use of a
   * list rather than a single type is because composite screens (Q3's triple,
   * Q10's month picker, Q11's star, Q14's chips + hours slider, plus the
   * confidence slider) render more than one control.
   */
  inputTypes: readonly QuestionInputType[];
  /** Whether the question must be answered before submit. */
  required: boolean;
  /** Whether a required confidence slider (1–5) applies (FR-11). */
  confidence: boolean;
  /** Whether the coach evaluates an answer on advance (spec.md §6.3). */
  coachable: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Answer value shapes, verbatim from tech_infrastructure.md §3.1. A question's
// stored payload is `QuestionAnswerValues[QuestionId]` — the discriminated
// union keyed by the same id the registry uses, so the shape can never drift
// from the question it belongs to.
// ─────────────────────────────────────────────────────────────────────────────

export interface Q2Value { who: string; because: string }
export interface Q3Value { metric: string; value: number; unit: string; why: string }
export interface Q5Value {
  pays: RoleId[];
  decides: RoleId[];
  uses: RoleId[];
  benefits: RoleId[];
}
export interface Q6Value { choice: Q6Choice; why: string }
export interface Q8Value {
  rank: AppId[];
  delete: AppId;
  why: string;
  predicted: AppId[];
}
export interface Q9Value { items: [string, string, string] }
export interface Q10Value {
  payer: string | string[];
  model: string;
  amount: number;
  unit: string;
  first_peso: string; // YYYY-MM
}
export interface Q11Rock { what: string; done_when: string }
export interface Q11Value { rocks: Q11Rock[]; starred: 0 | 1 | 2 }
/** Q14's full payload as submitted. `private_note` is split to its own row. */
export interface Q14Value {
  wants: FunctionId[];
  others: Record<string, FunctionId>;
  hours: number;
  private_note: string;
}

export interface QuestionAnswerValues {
  q1: { text: string };
  q2: Q2Value;
  q3: Q3Value;
  q4: { text: string };
  q5: Q5Value;
  q6: Q6Value;
  q7: { text: string };
  q8: Q8Value;
  q9: Q9Value;
  q10: Q10Value;
  q11: Q11Value;
  q12: { text: string };
  q13: { text: string; cause: Q13Cause };
  q14: Q14Value;
  q15: { text: string };
}

/** The stored answer value for one question, derived from §3.1. */
export type AnswerValueFor<K extends QuestionId> = QuestionAnswerValues[K];
/** Union of every question's answer value — one member per question. */
export type AnyAnswerValue = QuestionAnswerValues[QuestionId];
/**
 * The stored answer value for the long-text questions (q1/q13/q15). A union of
 * exactly the three §3.1 shapes, so the F03 long-text component is typed
 * against the questions it can actually be mounted for.
 */
export type LongTextValue = QuestionAnswerValues[LongTextQuestionId];
/**
 * The stored answer value for the sentence-completion question (q2). The §3.1
 * shape `{ who, because }` — exactly the two blanks the sentence carries.
 */
export type SentenceCompletionValue = QuestionAnswerValues[SentenceCompletionQuestionId];
/**
 * The stored answer value for the metric-triple question (q3). The §3.1 shape
 * `{ metric, value, unit, why }` — the four fields F03-T04 renders.
 */
export type MetricTripleValue = QuestionAnswerValues[MetricTripleQuestionId];
/**
 * The stored answer value for the matrix-grid question (q5). The §3.1 shape
 * `{ pays, decides, uses, benefits }` — the four role-id arrays the Q5 column
 * pivot (F03-T05) writes, whichever presentation the respondent used.
 */
export type MatrixGridValue = QuestionAnswerValues[MatrixGridQuestionId];
/**
 * The stored answer value for the single-choice + required-reason question
 * (q6). The §3.1 shape `{ choice, why }` — the four-option radio selection and
 * the one-line reason F03-T06 renders below it.
 */
export type SingleChoiceReasonValue = QuestionAnswerValues[SingleChoiceReasonQuestionId];
/**
 * The stored answer value for the tap-to-assign ranking question (q8). The §3.1
 * shape `{ rank, delete, why, predicted }` — the four-app ordering, the delete
 * choice, its one-line why, and the respondent's predicted group ranking that
 * F03-T07 collects below.
 */
export type RankingValue = QuestionAnswerValues[RankingQuestionId];
/**
 * The stored answer value for the paired-rows + star question (q11). The §3.1
 * shape `{ rocks, starred }` — three what/done-when pairs plus the index of
 * the one starred as the #1 priority that F03-T08 renders.
 */
export type PairedRowsValue = QuestionAnswerValues[PairedRowsQuestionId];
/**
 * The stored answer value for the capped short-text questions (q4/q7/q12). The
 * §3.1 shape `{ text }` — one hard-capped line (140 / 120 / 40 characters), so
 * the F03 short-text component is typed against the questions it can mount for.
 */
export type CappedShortTextValue = QuestionAnswerValues[CappedShortTextQuestionId];
/**
 * The stored answer value for the three-short-fields question (q9). The §3.1
 * shape `{ items: [string, string, string] }` — the three required refusals
 * F03-T10 renders, all of which must carry text before Q9 counts as answered.
 */
export type Q9ValueType = QuestionAnswerValues[Q9QuestionId];
/**
 * The stored answer value for the four-part money question (q10). The §3.1
 * shape `{ payer, model, amount, unit, first_peso }` — the payer and model
 * single choices, the peso amount whose label follows the model, and the
 * YYYY-MM month of the first real peso that F03-T10 renders.
 */
export type Q10ValueType = QuestionAnswerValues[Q10QuestionId];

// ─────────────────────────────────────────────────────────────────────────────
// The fifteen records. Section, text and helper are written verbatim from the
// baseline Part A so the RLS and renderer never carry their own copy of the
// questionnaire.
// ─────────────────────────────────────────────────────────────────────────────

export const QUESTIONS: readonly QuestionDefinition[] = [
  {
    id: "q1",
    section: "Why this exists",
    text: "Why does Anakloud need to exist?",
    helper:
      "In 2–3 sentences: what is broken in the world right now that Anakloud fixes? Write it the way you'd explain it to a friend who isn't in tech.",
    inputTypes: ["long_text"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q1 — wants raw voice
  },
  {
    id: "q2",
    section: "Why this exists",
    text: "If Anakloud disappeared tonight, who notices first?",
    helper:
      'Finish the sentence: "The people who would miss it most are ______, because ______."',
    inputTypes: ["sentence_completion"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q2 — no coach
  },
  {
    id: "q3",
    section: "Where we're going",
    text: "The number that would prove it worked",
    helper:
      "Three years from now, if Anakloud is working, what is the one number that proves it? Name the metric, then give the value. Then one line: why that number and not another?",
    inputTypes: ["metric_triple", "confidence_slider"],
    required: true,
    confidence: true, // FR-11
    coachable: true, // §6.3 Q3 — measurability, single metric
  },
  {
    id: "q4",
    section: "Where we're going",
    text: "Ten years, not three",
    helper:
      "Same question, but ten years out and allowed to be unreasonable. One sentence. If it doesn't feel slightly embarrassing to write down, it's too small. (140 character cap.)",
    inputTypes: ["short_text", "confidence_slider"],
    required: true,
    confidence: true, // FR-11
    coachable: true, // §6.3 Q4 — length, single statement
  },
  {
    id: "q5",
    section: "Who we're for",
    text: "The four roles",
    helper:
      "For each group below, mark which of the four things they do. A group can do more than one, or none.",
    inputTypes: ["matrix_grid"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q5 — structurally constrained
  },
  {
    id: "q6",
    section: "Who we're for",
    text: "The tiebreak",
    helper:
      "The therapy center wants one thing. The parent wants the opposite. We can only serve one. Whose side do we take? One line: why.",
    inputTypes: ["single_choice_reason"],
    required: true,
    confidence: false,
    coachable: true, // §6.3 Q6 — reason non-empty, not circular
  },
  {
    id: "q7",
    section: "Who we're for",
    text: "Why us and not the notebook",
    helper:
      'Finish this sentence in one line, max 120 characters: "A therapy center should switch from their notebook, Excel and Viber group to Anakloud because we are the only ones who ______."',
    inputTypes: ["short_text", "confidence_slider"],
    required: true,
    confidence: true, // FR-11
    coachable: true, // §6.3 Q7 — single promise, not a feature list
  },
  {
    id: "q8",
    section: "Focus",
    text: "Which door opens first",
    helper:
      "Rank the four apps by which one gets a customer to say yes first. Not which is most important long-term — which one opens the door. Then: if we had to delete one entirely and ship three, which goes? One line why.",
    inputTypes: ["ranking", "confidence_slider"],
    required: true,
    // FR-11 lists Q8 as confidence-bearing; §6.3 lists Q8 as NOT coached.
    // Both are deliberate and asserted in tests — a confidence slider and no coach.
    confidence: true, // FR-11
    coachable: false, // §6.3 Q8 — structurally constrained
  },
  {
    id: "q9",
    section: "Focus",
    text: "What we are deliberately not doing",
    helper:
      "Name three things Anakloud will not do in the next two years, even though they're tempting and someone will suggest them.",
    inputTypes: ["short_text"],
    required: true,
    confidence: false,
    coachable: true, // §6.3 Q9 — specificity
  },
  {
    id: "q10",
    section: "Money",
    text: "How the money works",
    helper:
      "Four parts. (a) Who physically pays us? (b) What's the model? (c) What do they pay, in pesos? (d) What month does the first real peso arrive?",
    inputTypes: ["month_picker", "confidence_slider"],
    required: true,
    confidence: true, // FR-11
    coachable: true, // §6.3 Q10 — completeness of the four parts
  },
  {
    id: "q11",
    section: "The next 90 days",
    text: "What must be done by year-end",
    helper:
      "Beta starts soon. Name up to three things that must be finished by 31 December 2026 for us to say the quarter worked. For each one, write how we'll know it's done — a number, a date, or something you could point at. 'Improve onboarding' is not done-able.",
    inputTypes: ["paired_rows_star", "confidence_slider"],
    required: true,
    confidence: true, // FR-11
    coachable: true, // §6.3 Q11 — done-condition is verifiable
  },
  {
    id: "q12",
    section: "The next 90 days",
    text: "Name the quarter",
    helper:
      "In 3–5 words, what should this quarter be called? Something people can actually repeat in a huddle. (40 character cap.)",
    inputTypes: ["short_text"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q12 — short by design
  },
  {
    id: "q13",
    section: "Risk, people, values",
    text: "Pre-mortem",
    helper:
      "It's early 2028. Anakloud is dead. Write the two sentences explaining what killed it. Then pick the most likely cause from the list.",
    inputTypes: ["long_text"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q13 — wants raw voice
  },
  {
    id: "q14",
    section: "Risk, people, values",
    text: "What you want to own, and what you think others own",
    helper:
      "(a) From the list, pick up to three functions you want to own. (b) For each teammate, name the one function you think they own. (c) Realistically, how many hours a week can you give Anakloud from October 2026? (d) Anything that would make you step back, that you haven't said out loud yet? (Only the facilitator sees (d).)",
    inputTypes: ["capped_multi_select", "numeric_slider"],
    required: true,
    confidence: false,
    coachable: false, // §6.3 Q14 — structurally constrained
  },
  {
    id: "q15",
    section: "Risk, people, values",
    text: "A moment worth copying",
    helper:
      "Think of a time someone on this team did something that made you think 'that's exactly how we should operate.' What did they do? Don't name the value — tell the story.",
    inputTypes: ["long_text"],
    required: false, // baseline marks Q15 "(optional)"
    confidence: false,
    coachable: false, // §6.3 Q15 — wants raw voice
  },
];

/** Roster of every question by its stable id. */
export const QUESTION_MAP: Record<QuestionId, QuestionDefinition> = QUESTIONS.reduce(
  (acc, q) => {
    acc[q.id] = q;
    return acc;
  },
  {} as Record<QuestionId, QuestionDefinition>,
);