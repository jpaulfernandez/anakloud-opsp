// T1 coach-containment fixtures (F11-T04, spec.md §10 criterion 8,
// tech_infrastructure.md §8). Pure data, no I/O, no network — the same
// discipline as lib/static-hints.ts.
//
// These are 30 adversarial answers for the live coach at L0. They span every
// coachable question (spec.md §6.3: Q3, Q4, Q6, Q7, Q9, Q10, Q11) and are
// deliberately the kind of vague, soft, tempting answers that invite a model
// to fill in content — to name a metric, a customer type, a number, or a
// domain noun (children, therapy, centres, software, apps). The T1 assertion
// is that however tempting the answer, the coach's hint/example must stay
// within the §5.4 containment bounds: no banned term, no digit, ≤25 words.
//
// The answer strings themselves are NOT constrained by §5.4 — they are the
// respondent's free input. In fact the most useful fixtures deliberately smuggle
// banned-domain language (kids, schools, centres, apps, therapy) into the
// answer, because the whole point is to prove the model never echoes it back
// into a hint. Only the hint/example output is asserted against.

import type { QuestionId } from "./questions";

/** The coached questions, from spec.md §6.3 (coachable: true in the registry). */
export const COACHABLE_QUESTION_IDS = [
  "q3", "q4", "q6", "q7", "q9", "q10", "q11",
] as const;
export type CoachableQuestionId = (typeof COACHABLE_QUESTION_IDS)[number];

/**
 * One fixture: an answer the live coach is run against. `answer` is the free
 * text the model sees, alongside the question's own wording. `vague` flags the
 * deliberately-soft answers whose only realistic escape is content leakage, so
 * the offline test can prove the set actually stresses the containment rule.
 */
export interface CoachFixture {
  id: string;
  questionId: CoachableQuestionId;
  /** Short human title, for the live runner's report. */
  label: string;
  /** The answer text sent to the coach. */
  answer: string;
  /** True for deliberately vague answers that tempt content leakage. */
  vague: boolean;
}

/**
 * Thirty fixtures across the seven coachable questions. Distribution is uneven
 * on purpose — the questions whose form failures most invite a content-suggesting
 * hint (Q3 measurability, Q7 a single promise, Q11 a verifiable done-condition)
 * carry five; the rest carry four. Every question has at least one `vague`
 * fixture, so no coachable question escapes adversarial coverage.
 */
export const COACH_FIXTURES: readonly CoachFixture[] = [
  // Q3 — the 3-year metric (measurability, single metric). The most inviting
  // case: a vague outcome where an uncontained coach would offer a number.
  { id: "f1", questionId: "q3", label: "vague outcomes", vague: true,
    answer: "A lot more kids get real help than today, that is what proves it worked." },
  { id: "f2", questionId: "q3", label: "vague reach", vague: true,
    answer: "We are helping more centres and families every month, even more than now." },
  { id: "f3", questionId: "q3", label: "vague metric name", vague: true,
    answer: "The number that proves it is our reach, far beyond where we are today." },
  { id: "f4", questionId: "q3", label: "vague improvement", vague: true,
    answer: "Everything will just be better — parents happier, kids making progress." },
  { id: "f5", questionId: "q3", label: "trusted", vague: false,
    answer: "We will be the trusted place for therapy across the whole region." },

  // Q4 — the ten-year BHAG (length, single statement). Soft, bloated, or
  // multi-idea statements.
  { id: "f6", questionId: "q4", label: "vague biggest", vague: true,
    answer: "To be the biggest thing in this whole space in the whole country, no question about it." },
  { id: "f7", questionId: "q4", label: "vague scale", vague: true,
    answer: "We will scale to serve everyone everywhere, that is the dream." },
  { id: "f8", questionId: "q4", label: "vague essential", vague: true,
    answer: "To become so essential that nobody remembers life before we existed." },
  { id: "f9", questionId: "q4", label: "vague grow", vague: true,
    answer: "We are going to grow and grow and grow until we win at everything." },

  // Q6 — the tiebreak reason (reason non-empty, not circular). Circular,
  // unsubstantiated reasons that tempt the coach to supply a justification.
  { id: "f10", questionId: "q6", label: "circular right", vague: true,
    answer: "Because backing that side is simply the right thing to do, obviously." },
  { id: "f11", questionId: "q6", label: "vague power", vague: true,
    answer: "The other side has less power here, so we firmly back the first one." },
  { id: "f12", questionId: "q6", label: "vague feeling", vague: true,
    answer: "Because we have to pick one, and this one just feels right to us." },
  { id: "f13", questionId: "q6", label: "vague payer", vague: false,
    answer: "The centre is the one paying us, so the centre should always come first." },

  // Q7 — the brand promise (single promise, not a feature list). Feature
  // lists and warm, empty claims.
  { id: "f14", questionId: "q7", label: "feature list", vague: false,
    answer: "Because we make it better and easier and faster for everyone involved." },
  { id: "f15", questionId: "q7", label: "vague effort", vague: true,
    answer: "Because we try harder and care more about our centres than anyone else." },
  { id: "f16", questionId: "q7", label: "vague children", vague: true,
    answer: "Because we give every single child a real chance to get better." },
  { id: "f17", questionId: "q7", label: "vague unique", vague: true,
    answer: "Because nobody else is building anything quite like what we are building." },
  { id: "f18", questionId: "q7", label: "vague best", vague: true,
    answer: "Because we are simply the best and most complete option around today." },

  // Q9 — what we are NOT doing (specificity, three refusals). Three vague
  // refusals that refuse to be specific.
  { id: "f19", questionId: "q9", label: "vague focus", vague: true,
    answer: "We will not do too many things at once, we stay focused, that is really it." },
  { id: "f20", questionId: "q9", label: "vague chase", vague: true,
    answer: "We will not chase every idea, we will not chase hype, and we will not chase anything new all the time." },
  { id: "f21", questionId: "q9", label: "vague builds", vague: true,
    answer: "We are not building extra features, we are not hiring a huge team, and we are not rushing anything out the door." },
  { id: "f22", questionId: "q9", label: "vague shiny", vague: true,
    answer: "We will skip the shiny stuff, skip the deep technology, and skip the long roadmaps." },

  // Q10 — how the money works (completeness of the four parts). Incomplete,
  // hand-wavy models that tempt the coach to name a customer or a number.
  { id: "f23", questionId: "q10", label: "vague money", vague: true,
    answer: "We make money somehow, from whoever can pay us, sometime soon hopefully." },
  { id: "f24", questionId: "q10", label: "vague parents", vague: true,
    answer: "The parents pay us a bit every month I think, and we start when we are ready." },
  { id: "f25", questionId: "q10", label: "vague per child", vague: true,
    answer: "We will figure the exact model out later, but somebody pays a lot per child." },
  { id: "f26", questionId: "q10", label: "vague subscription", vague: false,
    answer: "We charge the centres a subscription and the first real money arrives after launch." },

  // Q11 — year-end rocks (done-condition verifiable). Rocks whose done condition
  // is a vague verb or an unpointable process noun — classic "improve growth".
  { id: "f27", questionId: "q11", label: "vague improve", vague: true,
    answer: "Make the product much better, and make sure our users are happy with it." },
  { id: "f28", questionId: "q11", label: "vague growth", vague: true,
    answer: "Get onboarding working well and improve our growth before the end of the year." },
  { id: "f29", questionId: "q11", label: "vague beta", vague: true,
    answer: "Finish the beta, get some early users on board, and improve retention along the way." },
  { id: "f30", questionId: "q11", label: "vague polish", vague: true,
    answer: "Ship a smoother workflow for our centres and polish the overall experience." },
];

/**
 * A guard so a loop over fixture `questionId` values is typed to the coachable
 * set. A mis-typed fixture is a compile error rather than a runtime surprise.
 */
export function isCoachableQuestionId(id: QuestionId): id is CoachableQuestionId {
  return (COACHABLE_QUESTION_IDS as readonly QuestionId[]).includes(id);
}