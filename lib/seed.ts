import type { ClientBase } from "./db";
import { withRespondentContext } from "./access";
import { upsertAnswer, type Q14AnswerValue } from "./answers";
import { createBudgetForCohort } from "./budget";

// Seed data and the `db:seed` insert path (F01-T05, tech_infrastructure.md §8).
//
// The purpose of the seed is a data fixture for F10 divergence scoring: six
// respondents whose answers deliberately disagree, so the comparison and
// scoring can be developed without real humans. The three Part C categories
// (aligned / soft split / hard split) are therefore baked in explicitly and
// on the confidence-bearing questions — Q3 (aligned on unit), Q10 (soft split
// on pricing model, low confidence), Q8 (hard split on the door-opener
// ranking, high confidence) — so a deterministic scorer can label them now
// and F10-T01's threshold choices have a clear fixture to tune against.
//
// App and function identifiers are the stable ids the rest of the product will
// use; the fourth app is unnamed (plan blocker 2), so it gets the placeholder
// id "fourth_app" exactly as F03-T07 will. question_id values (q1..q15) are
// stable and never change. The product name "Anakloud" stays out of ids; this
// fixture's identifiers are the app/function slugs only.

export const questionIds = [
  "q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10",
  "q11", "q12", "q13", "q14", "q15",
] as const;

/** The four apps in Q8's ranking. The fourth is the unnamed one. */
export const APP_IDS = ["pedconnect", "teachday", "parentup", "fourth_app"] as const;

/** The functions a respondent can claim in Q14(a) (baseline §Q14 list). */
export const FUNCTION_IDS = [
  "product", "backend", "mobile_web", "qa", "design_ux",
  "data_privacy_security", "clinical_relations", "sales_partner",
  "doctor_relations", "onboarding_success", "support", "marketing",
  "finance", "fundraising", "legal_ip", "hiring",
] as const;

export const Q5_ROLE_IDS = [
  "pediatrician", "center_owner", "occupational_therapist",
  "speech_pathologist", "parent", "school_sped", "child", "lgu_doh",
  "hmo_insurer",
] as const;

export const Q6_CHOICES = ["center", "parent", "pedia", "therapist"] as const;

// Deterministic ids make the seed idempotent: re-running upserts in place
// instead of inserting a second cohort. Also used by the F10 fixtures later.
export const SEED_COHORT_ID = "10000000-0000-0000-0000-000000000001";

export const RESPONDENT_IDS = {
  ana: "20000000-0000-0000-0000-000000000001",
  ben: "20000000-0000-0000-0000-000000000002",
  carla: "20000000-0000-0000-0000-000000000003",
  diego: "20000000-0000-0000-0000-000000000004",
  elena: "20000000-0000-0000-0000-000000000005",
  facilitator: "20000000-0000-0000-0000-000000000006",
} as const;

// The answer value shapes in §3.1, kept explicit so the fixture values cannot
// silently drift from the payload the rest of the product reads.
export interface Q3Value { metric: string; value: number; unit: string; why: string }
export interface Q8Value {
  rank: string[];
  delete: string;
  why: string;
  predicted: string[];
}
export interface Q10Value {
  payer: string;
  model: string;
  amount: number;
  unit: string;
  first_peso: string; // YYYY-MM
}
export interface Q11Rock { what: string; done_when: string }
export interface Q11Value { rocks: Q11Rock[]; starred: number }

/**
 * The q14 value as the seed writes it. `private_note` is optional here only so
 * that a respondent without a note produces no `q14d` row at all — upsertAnswer
 * only splits off a private row when the key is present. When present, the key
 * is never empty: a note that says nothing should not create an empty private
 * row that later exports must remember to exclude.
 */
export type SeedQ14Value = Omit<Q14AnswerValue, "private_note"> & {
  private_note?: string;
};

export type SeedAnswerValue =
  | { text: string }
  | { who: string; because: string }
  | Q3Value
  | { pays: string[]; decides: string[]; uses: string[]; benefits: string[] }
  | { choice: string; why: string }
  | Q8Value
  | { items: [string, string, string] }
  | Q10Value
  | Q11Value
  | SeedQ14Value;

export interface SeedAnswer {
  question_id: string;
  value: SeedAnswerValue;
  /** Present only on the confidence-bearing questions (Q3, Q4, Q7, Q8, Q10, Q11). */
  confidence?: number;
}

export interface SeedRespondent {
  id: string;
  display_name: string;
  email: string;
  invite_token: string;
  resume_code: string;
  is_facilitator: boolean;
  answers: SeedAnswer[];
}

function answer(
  question_id: string,
  value: SeedAnswerValue,
  confidence?: number,
): SeedAnswer {
  return confidence === undefined
    ? { question_id, value }
    : { question_id, value, confidence };
}

const text = (t: string): { text: string } => ({ text: t });

// A shared "Pays / Decides / Uses / Benefits" matrix, varied only on the
// deciding role (the deliberate Q5 conflict from the baseline "How to read it").
function q5(decides: string[]): SeedAnswerValue {
  return {
    pays: ["center_owner"],
    decides,
    uses: ["occupational_therapist", "speech_pathologist"],
    benefits: ["child"],
  };
}

// The Q8 "which app opens the door" ranking. pedconnect-first and teachday-first
// are the two camps; each camp also predicts the group will say the *other*
// app is first (the baseline's "silent majority deferring" case).
function q8(lead: "pedconnect" | "teachday"): Q8Value {
  const first = [lead, lead === "pedconnect" ? "teachday" : "pedconnect"];
  const rank = [...first, "parentup", "fourth_app"];
  const predicted = [...([...first].reverse()), "parentup", "fourth_app"];
  return {
    rank,
    delete: "fourth_app",
    why:
      lead === "pedconnect"
        ? "The referral is the scarce resource; a center with no incoming referrals needs no software to manage them."
        : "Centers have the money and the daily pain; doctors will not change a fifteen-year referral habit for a startup.",
    predicted,
  };
}

const R1 = RESPONDENT_IDS.ana;
const R2 = RESPONDENT_IDS.ben;
const R3 = RESPONDENT_IDS.carla;
const R4 = RESPONDENT_IDS.diego;
const R5 = RESPONDENT_IDS.elena;
const R6 = RESPONDENT_IDS.facilitator;

function hoursAndOthers(respondentId: string, hours: number): { hours: number; others: Record<string, string> } {
  return {
    hours,
    // Each respondent names one function they think each teammate owns.
    others: {
      [R1]: "backend",
      [R2]: "mobile_web",
      [R3]: "data_privacy_security",
      [R4]: "sales_partner",
      [R5]: "design_ux",
      [R6]: "finance",
    },
  };
}

function q14(
  respondentId: string,
  wants: string[],
  hours: number,
  private_note: string,
): SeedQ14Value {
  const base = {
    wants,
    ...hoursAndOthers(respondentId, hours),
  };
  return private_note === "" ? base : { ...base, private_note };
}

function baseAnswers(person: {
  id: string;
  q1: string;
  q2: string;
  q3why: string;
  q3value: number;
  q4: string;
  q5decides: string[];
  q6: string;
  q6why: string;
  q7: string;
  q8lead: "pedconnect" | "teachday";
  q9: [string, string, string];
  q10model: string;
  q10unit: string;
  q10amount: number;
  q10first: string;
  q11: Q11Value;
  q12: string;
  q13: string;
  q14: SeedQ14Value;
  q15: string;
}): SeedAnswer[] {
  return [
    answer("q1", text(person.q1)),
    answer("q2", { who: person.q2, because: "they would go back to rebuilding schedules and tracking progress by hand every morning." }),
    answer("q3", { metric: "paying therapy centers", value: person.q3value, unit: "paying_centers", why: person.q3why }, 3),
    answer("q4", text(person.q4), 2),
    answer("q5", q5(person.q5decides)),
    answer("q6", { choice: person.q6, why: person.q6why }),
    answer("q7", text(person.q7), 4),
    answer("q8", q8(person.q8lead), person.id === R2 || person.id === R5 ? 4 : 5),
    answer("q9", { items: person.q9 }),
    answer("q10", { payer: "center", model: person.q10model, amount: person.q10amount, unit: person.q10unit, first_peso: person.q10first }, person.id === R2 || person.id === R4 || person.id === R6 ? 2 : 1),
    answer("q11", person.q11, 4),
    answer("q12", text(person.q12)),
    answer("q13", text(person.q13)),
    answer("q14", person.q14),
    answer("q15", text(person.q15)),
  ];
}

export const SEED_RESPONDENTS: SeedRespondent[] = [
  {
    id: R1,
    display_name: "Ana Reyes",
    email: "ana@anakloud.ph",
    invite_token: "seed-token-ana",
    resume_code: "AVERYQ",
    is_facilitator: false,
    answers: baseAnswers({
      id: R1,
      q1: "Children with developmental delay in the Philippines wait months for assessment and travel hours for therapy, and most give up. We exist so that waiting stops being the reason a child misses care.",
      q2: "Therapy center admins",
      q3why: "Centers are the distribution; everything real runs on them adopting us.",
      q3value: 300,
      q4: "Every child in the Philippines with a developmental delay is identified before age five.",
      q5decides: ["center_owner"],
      q6: "center",
      q6why: "They pay, and if they churn there is no data for the parent to look at anyway.",
      q7: "show the parent, the therapist and the referring doctor the same live progress record.",
      q8lead: "pedconnect",
      q9: ["no teletherapy", "adult rehab", "hospitals"],
      q10model: "monthly_subscription",
      q10unit: "per_center",
      q10amount: 2500,
      q10first: "2027-01",
      q11: {
        rocks: [
          { what: "Onboard beta centers", done_when: "8 centers each logged 20+ real sessions" },
          { what: "Prove the referral loop", done_when: "15 referrals complete end to end" },
          { what: "Data privacy baseline", done_when: "NPC registration filed, DPO named" },
        ],
        starred: 0,
      },
      q12: "Make the referral loop real",
      q13: "Centers loved every demo and never changed how they worked. We mistook enthusiasm for adoption, squandered three months, and ran out of money.",
      q14: q14(R1, ["product", "backend", "data_privacy_security"], 30, "If we are still unpaid by March I will need to take a job. I don't know how to bring it up."),
      q15: "When the demo crashed in front of the panel, J didn't explain it away. Said 'that's a real bug, we'll fix it,' and had it fixed that night.",
    }),
  },
  {
    id: R2,
    display_name: "Benito Cruz",
    email: "ben@anakloud.ph",
    invite_token: "seed-token-ben",
    resume_code: "BRICKZ",
    is_facilitator: false,
    answers: baseAnswers({
      id: R2,
      q1: "Parents pay months for therapy and never see if it works. We make progress visible so families know what they are buying.",
      q2: "Therapy center admins",
      q3why: "Adoption in real centers is the number that proves we changed healthcare delivery.",
      q3value: 350,
      q4: "The default operating system for pediatric therapy in Southeast Asia.",
      q5decides: ["center_owner"],
      q6: "center",
      q6why: "Centers gate every therapist in the country; win them and the parents follow.",
      q7: "cut two hours of admin per therapist per week.",
      q8lead: "pedconnect",
      q9: ["no adult rehab", "no teletherapy", "no hospitals"],
      q10model: "monthly_subscription",
      q10unit: "per_center",
      q10amount: 2800,
      q10first: "2027-03",
      q11: {
        rocks: [
          { what: "Prove the referral loop", done_when: "15 referrals complete doctor → center → parent" },
          { what: "Decide the wedge", done_when: "written evidence of which app gets a yes fastest" },
        ],
        starred: 0,
      },
      q12: "Eight centers, zero drop-offs",
      q13: "Two of us took full-time jobs in November and it went quiet by February. Nobody ever said it was over, it just ended.",
      q14: q14(R2, ["product", "mobile_web", "design_ux"], 40, ""),
      q15: "R spent a whole Saturday sitting in a therapy center watching, and came back and told us half our screens were wrong.",
    }),
  },
  {
    id: R3,
    display_name: "Carla Santos",
    email: "carla@anakloud.ph",
    invite_token: "seed-token-carla",
    resume_code: "CLANTX",
    is_facilitator: false,
    answers: baseAnswers({
      id: R3,
      q1: "Therapy centers run on notebooks and Viber groups, so nobody can answer how many active clients they have. We give them the system they would have if software were built for this market.",
      q2: "Therapy center admins",
      q3why: "It is the count that means we actually reached the families we claim to serve.",
      q3value: 250,
      q4: "The operating system the whole sector runs on before ten years are out.",
      q5decides: ["center_owner"],
      q6: "center",
      q6why: "The parent picks whoever the center already trusts; we have to earn the center's adoption first.",
      q7: "connect the referral, the sessions and the progress report in one thread.",
      q8lead: "pedconnect",
      q9: ["no funds management", "no adult market", "no overseas expansion yet"],
      q10model: "monthly_subscription",
      q10unit: "per_center",
      q10amount: 3000,
      q10first: "2026-12",
      q11: {
        rocks: [
          { what: "Data privacy baseline", done_when: "NPC registration filed, consent flow shipped" },
          { what: "Hire a clinical adviser", done_when: "an OT or SLP on retainer" },
        ],
        starred: 2,
      },
      q12: "Prove someone will pay",
      q13: "We spread our tooling across four apps and none got good enough for anyone to pay for. Death by a thousand betas.",
      q14: q14(R3, ["backend", "qa", "data_privacy_security"], 35, ""),
      q15: "When I said our consent copy read like legalese, L rewrote it in one evening in words a parent would say. No fuss, just fixed.",
    }),
  },
  {
    id: R4,
    display_name: "Diego Tan",
    email: "diego@anakloud.ph",
    invite_token: "seed-token-diego",
    resume_code: "DELTAP",
    is_facilitator: false,
    answers: baseAnswers({
      id: R4,
      q1: "A parent in Cavite waits four to six months for a developmental assessment, then travels two hours each way for weekly sessions. We exist so distance stops deciding who gets care.",
      q2: "Therapy center admins",
      q3why: "Engaged centers are the only durable signal that clinicians actually adopted the workflow.",
      q3value: 400,
      q4: "Every child in the country referred for developmental therapy is seen, tracked and supported by us.",
      q5decides: ["pediatrician"],
      q6: "parent",
      q6why: "Demand comes from parents; centers will adopt whatever parents are already asking for.",
      q7: "are built specifically for Filipino pediatric therapy, not adapted from a US EMR.",
      q8lead: "teachday",
      q9: ["no teletherapy", "no adult rehab", "no billing we build ourselves"],
      q10model: "per_active_child",
      q10unit: "per_child",
      q10amount: 200,
      q10first: "2026-11",
      q11: {
        rocks: [
          { what: "Prove the referral loop", done_when: "15 referrals complete end to end" },
          { what: "Onboard beta centers", done_when: "8 centers each logged 20+ real sessions" },
          { what: "Decide the wedge", done_when: "written evidence of which app gets a yes fastest" },
        ],
        starred: 2,
      },
      q12: "From school project to company",
      q13: "Doctors never referred through us; we built the center product for nobody. The pipeline dried up and the runway ran out.",
      q14: q14(R4, ["product", "sales_partner", "doctor_relations"], 40, "I have been quietly assuming everyone else is full-time; I can only give evenings after the clinic at best."),
      q15: "M walked a skeptical center owner through the product for an hour and left having learned our biggest onboarding blocker, not having sold anything.",
    }),
  },
  {
    id: R5,
    display_name: "Elena Villanueva",
    email: "elena@anakloud.ph",
    invite_token: "seed-token-elena",
    resume_code: "ELANVX",
    is_facilitator: false,
    answers: baseAnswers({
      id: R5,
      q1: "Nobody can tell a clinician, a parent or a school the truth about a child's progress because the record lives in six places. We make the progress record one connected thing.",
      q2: "Therapy center admins",
      q3why: "Centers paying us month after month proves the software earns its keep in their workflow.",
      q3value: 275,
      q4: "The record every pediatric therapist in the Philippines reaches for by default.",
      q5decides: ["pediatrician"],
      q6: "parent",
      q6why: "The parent is the human we are actually here for; everything else is infrastructure.",
      q7: "make the parent, the school and the clinic finally see the same progress story.",
      q8lead: "teachday",
      q9: ["no own billing", "no adult rehab", "no hospitals"],
      q10model: "per_active_child",
      q10unit: "per_child",
      q10amount: 250,
      q10first: "2027-01",
      q11: {
        rocks: [
          { what: "Decide the wedge", done_when: "written evidence of which app gets a yes fastest" },
          { what: "Onboard beta centers", done_when: "8 centers each logged 20+ real sessions" },
        ],
        starred: 1,
      },
      q12: "Prove someone will pay",
      q13: "We kept building features nobody had asked for and ignored the empty sales pipeline. When we finally looked, there were no customers left to lose.",
      q14: q14(R5, ["design_ux", "marketing", "onboarding_success"], 8, ""),
      q15: "When I flagged a privacy gap late on a Friday, D owned it, drafted the fix and asked for review rather than parking it till Monday.",
    }),
  },
  {
    id: R6,
    display_name: "Lia Mendoza",
    email: "lia@anakloud.ph",
    invite_token: "seed-token-lia",
    resume_code: "FALCUN",
    is_facilitator: true,
    answers: baseAnswers({
      id: R6,
      q1: "Children with delays are lost because assessment and therapy sit on opposite sides of a commute most families cannot afford. We collapse that distance.",
      q2: "Therapy center admins",
      q3why: "The number of centers actively paying is the honest test of whether we built something clinics keep.",
      q3value: 250,
      q4: "The default way pediatric developmental care is delivered in the Philippines.",
      q5decides: ["pediatrician"],
      q6: "parent",
      q6why: "We cannot be about the parent and then abandon them the moment money is mentioned.",
      q7: "give every parent a therapist-backed progress record they actually understand.",
      q8lead: "teachday",
      q9: ["no teletherapy", "no adult market", "no own payments"],
      q10model: "per_active_child",
      q10unit: "per_child",
      q10amount: 150,
      q10first: "2026-12",
      q11: {
        rocks: [
          { what: "Hire a clinical adviser", done_when: "an OT or SLP on retainer reviewing our framework" },
          { what: "Prove the referral loop", done_when: "15 referrals complete end to end" },
        ],
        starred: 0,
      },
      q12: "From school project to company",
      q13: "We avoided the hard conversation about who officially owns what, kept everything urgent, and drifted apart when the deadlines passed.",
      q14: q14(R6, ["backend", "finance", "fundraising"], 20, ""),
      q15: "At the review C said plainly that our pricing was a guess, and insisted we go ask real centers before we touch a change request. Best ten minutes of the year.",
    }),
  },
];

function facilitatorCount(): number {
  return SEED_RESPONDENTS.filter((r) => r.is_facilitator).length;
}

/**
 * Insert the seed cohort and its six respondents idempotently. Idempotent
 * because the ids are deterministic: a re-run lands on `on conflict do
 * nothing` for the cohort and respondents, then re-upserts the answers.
 *
 * Answers are written inside each respondent's own RLS context (F01-T04), so
 * the role running the seed only needs to be allowed to insert into `cohorts`
 * and `respondents` — the answer writes go through the same respondent scoping
 * the application uses. Callers must `connect()` first and `end()` the client.
 */
export async function seedCohort(db: ClientBase): Promise<void> {
  if (facilitatorCount() !== 1) {
    throw new Error(
      `seed cohort must have exactly one facilitator, found ${facilitatorCount()}`,
    );
  }

  await db.query(
    `insert into cohorts (id, name, quarter_label, status)
     values ($1, 'Anakloud Q4 2026', 'Q4 2026', 'open')
     on conflict (id) do nothing`,
    [SEED_COHORT_ID],
  );

  // Every cohort carries a token budget from creation (F12-T04), so the cap
  // exists before the first AI call can spend against it.
  await createBudgetForCohort(db, SEED_COHORT_ID);

  for (const respondent of SEED_RESPONDENTS) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do nothing`,
      [
        respondent.id,
        SEED_COHORT_ID,
        respondent.display_name,
        respondent.email,
        respondent.invite_token,
        respondent.resume_code,
        respondent.is_facilitator,
      ],
    );
  }

  // The q14 value already holds private_note; upsertAnswer splits it into the
  // q14 public row and a q14d private row. This is the same path the real
  // respondent write uses, so the fixture exercises the split too.
  for (const respondent of SEED_RESPONDENTS) {
    await withRespondentContext(db, respondent.id, async (tx) => {
      for (const a of respondent.answers) {
        await upsertAnswer(tx, {
          respondent_id: respondent.id,
          question_id: a.question_id,
          value: a.value,
          confidence: a.confidence ?? null,
        });
      }
    });
  }
}

/**
 * Assert the seeded answers contain one aligned, one soft split and one hard
 * split under the Part C rubric. Kept as a pure function on the fixture data
 * so the categories are guaranteed by the data itself before F10's scorer
 * exists; F10-T01 will label the same fixture through its own thresholds.
 */
export function checkDivergenceFixture(
  respondents: ReadonlyArray<Pick<SeedRespondent, "answers">> = SEED_RESPONDENTS,
): void {
  const q8 = respondents.map((r) => r.answers.find((a) => a.question_id === "q8")!);
  const q10 = respondents.map((r) => r.answers.find((a) => a.question_id === "q10")!);
  const q3 = respondents.map((r) => r.answers.find((a) => a.question_id === "q3")!);

  const q3Units = new Set(q3.map((a) => (a.value as Q3Value).unit));
  if (q3Units.size !== 1) {
    throw new Error("seed should be aligned on Q3's unit");
  }

  const q10Models = new Set(q10.map((a) => (a.value as Q10Value).model));
  if (q10Models.size < 2) {
    throw new Error("seed should soft-split on Q10's model");
  }
  if (!q10.every((a) => (a.confidence ?? 5) <= PART_C_SOFT_CONFIDENCE)) {
    throw new Error("seed should soft-split with low confidence on Q10");
  }

  const q8Leads = new Set((q8[0].value as Q8Value).rank.length > 0
    ? q8.map((a) => (a.value as Q8Value).rank[0])
    : []);
  const leads = [...q8Leads];
  if (leads.length < 2) {
    throw new Error("seed should hard-split on Q8's door-opener");
  }
  for (const lead of leads) {
    const byLead = q8.filter((a) => (a.value as Q8Value).rank[0] === lead);
    if (byLead.length < 2) {
      throw new Error("seed hard split needs a real split, not a lone dissenter");
    }
  }
  if (!q8.every((a) => (a.confidence ?? 0) >= PART_C_HARD_CONFIDENCE)) {
    throw new Error("seed should hard-split with high confidence on Q8");
  }
}

/** Confidence at or below this means "low" for the Part C soft-split rubric. */
export const PART_C_SOFT_CONFIDENCE = 2;
/** Confidence at or above this means "high" for the Part C hard-split rubric. */
export const PART_C_HARD_CONFIDENCE = 4;