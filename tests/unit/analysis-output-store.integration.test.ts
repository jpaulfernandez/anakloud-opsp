import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import type { AnalysisServeBody } from "../../lib/analyse-endpoint";
import type { QuestionId } from "../../lib/questions";
import {
  listAnalysisOutputs,
  recordAnalysisOutput,
} from "../../lib/analysis-output-store";

// F14-T06 acceptance over a real Postgres — durable retention with the level
// recorded per output (FR-35). Purely DB-gated (DATABASE_URL + RUN_DB_TESTS),
// so it SKIPs by default and does not touch `./verify.sh` without a database;
// the pure seams the same store exposes are asserted in the non-gated
// analysis-output-store.test.ts.
//
// Proves, against actual rows:
//   1. Re-running preserves the prior output and its label — recording twice
//      yields two rows, ordered oldest-first, neither overwritten.
//   2. A model change between runs is visible in the labels — the stored
//      `model` column records each run's pinned model.
//   3. Level is recorded per output — the stored `level` column matches the
//      served level of each run, model and deterministic branches alike.
//
// Runs in its own temporary schema so a dev database is never clobbered.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "bb112233-1234-4321-abcd-bb1122334455";
const FACILITATOR = "89000000-0000-0000-0000-000000000082";
const OTHER = "71000000-0000-0000-0000-000000000093"; // a plain respondent

describe.skipIf(!enabled)("analysis output retention against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `analysis_outputs_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, email, invite_token, resume_code, is_facilitator)
       values ($1, $2, $3, $4, $5, $6, true)`,
      [FACILITATOR, COHORT, "Facilitator", "fac@example.ph", "token-fac-anout", "FACAN1"],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Plain respondent', 'token-oth-anout', 'OTHAN1')`,
      [OTHER, COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  function readBody(
    model: string,
    generatedAt: string,
  ): AnalysisServeBody {
    return {
      ok: true,
      level: "L0",
      scope: "question",
      questionId: "q8",
      analysis: {
        agreement: `agree via ${model}`,
        conflicts: [],
        askInRoom: ["ask"],
        wordingNote: null,
      },
      label: { model, generatedAt },
    };
  }

  function scoringBody(
    level: "L2" | "L3",
    questionId: QuestionId | null,
  ): AnalysisServeBody {
    return {
      ok: true,
      level,
      scope: questionId === null ? "cohort" : "question",
      questionId,
      scoring: {
        scope: questionId === null ? "cohort" : "question",
        questionId,
        results: [],
        exportOptions: { csv: "/api/admin/export", projection: "/admin/projection" },
      },
      label: { model: "", generatedAt: "2026-08-17T10:00:00.000Z" },
    };
  }

  /** Narrow a stored body to the L0 read, so `.analysis` is type-safe. */
  function readOf(body: AnalysisServeBody) {
    if (body.level !== "L0") throw new Error("expected an L0 read");
    return body;
  }

  it("retains the prior output when a re-run is recorded, oldest first, each with its own label", async () => {
    await recordAnalysisOutput(
      db!,
      FACILITATOR,
      COHORT,
      readBody("claude-sonnet-4", "2026-08-17T12:34:00.000Z"),
    );
    await recordAnalysisOutput(
      db!,
      FACILITATOR,
      COHORT,
      readBody("claude-sonnet-5-0", "2026-08-17T13:00:00.000Z"),
    );

    const history = await listAnalysisOutputs(db!, FACILITATOR, COHORT, "question", "q8");
    expect(history).toHaveLength(2);
    // Re-running preserved the prior output and its label; the re-run lands last.
    expect(history[0].label.model).toBe("claude-sonnet-4");
    expect(history[0].label.generatedAt).toBe("2026-08-17T12:34:00.000Z");
    expect(readOf(history[0]).analysis.agreement).toBe("agree via claude-sonnet-4");
    expect(history[1].label.model).toBe("claude-sonnet-5-0");
    expect(readOf(history[1]).analysis.agreement).toBe("agree via claude-sonnet-5-0");
  });

  it("records the serving level and the pinned model in each output's row", async () => {
    const { rows } = await db!.query<{
      level: string;
      model: string | null;
      generated_at: Date;
    }>(
      `select level, model, generated_at from analysis_outputs
        where cohort_id = $1 and scope = 'question' and question_id = 'q8'
        order by generated_at asc`,
      [COHORT],
    );
    expect(rows).toHaveLength(2);
    // Level is recorded per output, and the model change between runs is visible.
    expect(rows[0].level).toBe("L0");
    expect(rows[0].model).toBe("claude-sonnet-4");
    expect(rows[1].level).toBe("L0");
    expect(rows[1].model).toBe("claude-sonnet-5-0");
  });

  it("records the deterministic serving level with no model on the scoring branch", async () => {
    await recordAnalysisOutput(
      db!,
      FACILITATOR,
      COHORT,
      scoringBody("L2", "q1"),
    );
    await recordAnalysisOutput(
      db!,
      FACILITATOR,
      COHORT,
      scoringBody("L3", null),
    );

    const questionHistory = await listAnalysisOutputs(db!, FACILITATOR, COHORT, "question", "q1");
    expect(questionHistory).toHaveLength(1);
    expect(questionHistory[0].level).toBe("L2");
    expect(questionHistory[0].label.model).toBe("");

    const cohortHistory = await listAnalysisOutputs(db!, FACILITATOR, COHORT, "cohort", null);
    expect(cohortHistory).toHaveLength(1);
    expect(cohortHistory[0].level).toBe("L3");
    // Question rows do not leak into the cohort history and vice versa.
    expect(cohortHistory[0].questionId).toBeNull();
  });

  it("a non-facilitator cannot read the retained prep output (RLS)", async () => {
    const hidden = await listAnalysisOutputs(db!, OTHER, COHORT, "question", "q8");
    expect(hidden).toHaveLength(0);
  });
});