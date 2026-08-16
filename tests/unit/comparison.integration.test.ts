import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  fetchQuestionComparison,
  type ComparisonAnswerAnonymised,
} from "../../lib/comparison";

// F10-T02 — the comparison endpoint's data path against a real Postgres. Runs
// only when opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS
// otherwise, inside a temporary schema it drops afterwards — the same pattern
// as the other DB tests.
//
// Proves the acceptances that need a database: the anonymised payload carries
// no name, email or respondent id under inspection of the raw serialised
// response; the Q14(d) private note is excluded at the query layer even on the
// facilitator read path; and a divergence result is present for every question.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "cccc1111-cccc-1111-cccc-111111111401";
const FACILITATOR = "cccc1111-cccc-1111-cccc-111111111402";
const ANA = "cccc1111-cccc-1111-cccc-111111111403";
const BEN = "cccc1111-cccc-1111-cccc-111111111404";

// Identity values that must never appear in the anonymised payload (FR-30).
const ANA_NAME = "Ana Reyes";
const BEN_NAME = "Benito Cruz";
const ANA_EMAIL = "ana@anakloud.ph";
const BEN_EMAIL = "ben@anakloud.ph";

// The private note must never be served by this route, even to the facilitator.
const STORED_PRIVATE_NOTE = "I may need to step back after March.";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

/** Write one answer to one respondent in their own RLS context. */
async function write(
  respondentId: string,
  questionId: string,
  value: object,
  confidence?: number,
) {
  await withRespondentContext(db!, respondentId, (tx) =>
    upsertAnswer(tx, {
      respondent_id: respondentId,
      question_id: questionId,
      value,
      confidence: confidence ?? null,
    }),
  );
}

describe.skipIf(!enabled)("comparison data endpoint against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `comparison_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    const respondent = (
      id: string,
      name: string,
      email: string,
      token: string,
      code: string,
      fac = false,
    ) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, COHORT, name, email, token, code, fac],
      );

    // A submitted facilitator (F09-T01) is not needed here — fetchQuestionComparison
    // is called directly — but the respondents stay unsubmitted so upsertAnswer
    // (which refuses writes to a submitted respondent) can seed the answers.
    await respondent(FACILITATOR, "Lia Mendoza", "lia@anakloud.ph", "token-cmp-fac", "CMPF1", true);
    await respondent(ANA, ANA_NAME, ANA_EMAIL, "token-cmp-ana", "CMPA1");
    await respondent(BEN, BEN_NAME, BEN_EMAIL, "token-cmp-ben", "CMPB1");

    // Q3 closed + confidence: a real split (different unit), low confidence → soft split.
    await write(ANA, "q3", { metric: "paying centers", value: 300, unit: "paying_centers", why: "a" }, 3);
    await write(BEN, "q3", { metric: "paying centers", value: 350, unit: "visits", why: "b" }, 2);

    // Q1 open text: prose, flagged for manual review.
    await write(ANA, "q1", { text: "Children wait months for assessment and therapy." });
    await write(BEN, "q1", { text: "The record lives in six places and nobody can read it." });

    // Q14 with a private note: the note must stay off every mode of this route.
    await write(ANA, "q14", {
      wants: ["product"],
      others: { [BEN]: "backend" },
      hours: 30,
      private_note: STORED_PRIVATE_NOTE,
    });
    await write(BEN, "q14", {
      wants: ["backend"],
      others: { [ANA]: "product" },
      hours: 20,
    });
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("returns every respondent's answer with the divergence result", async () => {
    const comparison = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q3", "anonymised");
    expect(comparison.questionId).toBe("q3");
    expect(comparison.mode).toBe("anonymised");
    expect(comparison.answers).toHaveLength(2);
    expect(comparison.divergence.included).toBe(2);
    expect(comparison.divergence.agreementRate).toBe(0.5);
    expect(comparison.divergence.spread).toBe(0.5);
    expect(comparison.divergence.category).toBe("soft split");
  });

  it("serves a divergence result for open-text questions too", async () => {
    const comparison = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q1", "anonymised");
    expect(comparison.answers).toHaveLength(2);
    expect(comparison.divergence.mode).toBe("open");
    expect(comparison.divergence.category).toBe("manual review");
    expect(comparison.divergence.wordCounts).toHaveLength(2);
  });

  it("anonymised payload contains no name, email or respondent id", async () => {
    const comparison = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q3", "anonymised");
    const serialized = JSON.stringify(comparison);

    // True identity values, present in the rows fetched by the query, must not
    // appear anywhere in the serialised anonymised payload (FR-30).
    expect(serialized).not.toContain(ANA_NAME);
    expect(serialized).not.toContain(BEN_NAME);
    expect(serialized).not.toContain(ANA_EMAIL);
    expect(serialized).not.toContain(BEN_EMAIL);
    expect(serialized).not.toContain(ANA.toUpperCase());
    expect(serialized).not.toContain(BEN.toUpperCase());
    expect(serialized).not.toContain(ANA);
    expect(serialized).not.toContain(BEN);

    // Every answer object carries exactly the answer data, never identity keys.
    for (const a of comparison.answers as ComparisonAnswerAnonymised[]) {
      expect(Object.keys(a).sort()).toEqual(["confidence", "value"]);
    }
  });

  it("attributed mode includes names and respondent ids", async () => {
    const comparison = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q3", "attributed");
    const serialized = JSON.stringify(comparison);
    expect(serialized).toContain(ANA_NAME);
    expect(serialized).toContain(BEN_NAME);

    const keys = new Set(comparison.answers.map((a) => Object.keys(a).sort().join(",")));
    expect(keys).toEqual(new Set(["confidence,email,name,respondentId,value"]));
  });

  it("orders answers deterministically across loads", async () => {
    const first = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q1", "anonymised");
    const second = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q1", "anonymised");
    // Named order is Ana before Benito; anonymised drops identity but keeps the
    // same stable ordering, so two loads shape identically.
    expect(JSON.stringify(first.answers)).toBe(JSON.stringify(second.answers));
  });

  it("never returns the q14 private note in any mode", async () => {
    for (const mode of ["anonymised", "attributed"] as const) {
      const comparison = await fetchQuestionComparison(db!, FACILITATOR, COHORT, "q14", mode);
      const serialized = JSON.stringify(comparison);
      // The private note exists in the cohort and is visible to the facilitator's
      // RLS context, but this route must exclude it at the query layer.
      expect(serialized).not.toContain(STORED_PRIVATE_NOTE);

      for (const a of comparison.answers) {
        expect((a.value as Record<string, unknown>).private_note).toBeUndefined();
      }
      // Both respondents answered q14 in public rows only.
      expect(comparison.answers).toHaveLength(2);
      expect(comparison.divergence.included).toBe(2);
    }
  });
});