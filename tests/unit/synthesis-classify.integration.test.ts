import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  attachSourceCard,
} from "../../lib/official-source-cards";
import {
  getOrCreateOfficialDraft,
  latestOfficialDraft,
} from "../../lib/official-opsp";
import {
  buildClassificationContext,
  runClassificationAttempt,
} from "../../lib/synthesis-classify";
import { buildClassificationMessages } from "../../lib/synthesis-classify-prompt";
import type { AIProvider, GatewayContext, ProviderResponse } from "../../lib/ai-gateway";

// F15-T03 acceptance against a real Postgres: two clearly incompatible seeded
// answers attached as source cards to one cell classify as incompatible, and
// the classification is a distinct call with its own logged interaction row
// (purpose "synthesis", question_id null). Like the other DB suites these skip
// unless the operator opts in (DATABASE_URL set AND RUN_DB_TESTS=1).
//
// The fixture is the confident split on Q6 (the seed's centre camp vs parent
// camp) attached to the sandbox_core_customer cell — the two camps say
// opposite things about who the core customer is, so the classification verdict
// for them is incompatible.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("official OPSP compatibility classification (F15-T03)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `synthesis_classify_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  /**
   * Seed an isolated cohort with a facilitator and two respondents whose Q6
   * answers are the seed's genuinely incompatible centre-camp vs parent-camp
   * positions.
   */
  async function makeCellWithTwoCards(): Promise<{ cohortId: string; facilitatorId: string }> {
    const cohortId = randomUUID();
    const facilitatorId = randomUUID();
    const centreId = randomUUID();
    const parentId = randomUUID();
    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Team', 'Q4 2026', 'open')`,
      [cohortId],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', $3, 'CLASF', true)`,
      [facilitatorId, cohortId, `token-fac-${cohortId}`],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Centre Camp', $3, 'CLC1')`,
      [centreId, cohortId, `token-c1-${cohortId}`],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Parent Camp', $3, 'CLP1')`,
      [parentId, cohortId, `token-p1-${cohortId}`],
    );
    // The two incompatible public answers on Q6 (the seed's confident split).
    await db!.query(
      `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
       values ($1, $2, 'q6', $3::jsonb, false, null)`,
      [
        randomUUID(),
        centreId,
        JSON.stringify({
          choice: "center",
          why: "They pay, and if they churn there is no data for the parent to look at anyway.",
        }),
      ],
    );
    await db!.query(
      `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
       values ($1, $2, 'q6', $3::jsonb, false, null)`,
      [
        randomUUID(),
        parentId,
        JSON.stringify({
          choice: "parent",
          why: "The parent is the human we are actually here for; everything else is infrastructure.",
        }),
      ],
    );

    await getOrCreateOfficialDraft(db!, facilitatorId, cohortId);
    await attachSourceCard(db!, facilitatorId, cohortId, {
      cellId: "sandbox_core_customer",
      respondentId: centreId,
      questionId: "q6",
    });
    await attachSourceCard(db!, facilitatorId, cohortId, {
      cellId: "sandbox_core_customer",
      respondentId: parentId,
      questionId: "q6",
    });

    return { cohortId, facilitatorId };
  }

  it("two clearly incompatible seeded answers classify as incompatible (acceptance 2)", async () => {
    const c = await makeCellWithTwoCards();
    const draft = await withRespondentContext(db!, c.facilitatorId, (tx) =>
      latestOfficialDraft(tx, c.cohortId),
    );
    const ctx = buildClassificationContext(draft!.cells.sandbox_core_customer, "sandbox_core_customer");

    // The payload the model sees is the two camps' own words, anonymised A/B.
    const rendered = buildClassificationMessages(ctx).messages[0].content;
    expect(rendered).toContain("Respondent A");
    expect(rendered).toContain("Respondent B");
    expect(rendered).toContain("The parent is the human we are actually here for");
    expect(rendered).not.toContain("Centre Camp");
    expect(rendered).not.toContain("Parent Camp");

    // A model judging these genuinely incompatible sources returns incompatible.
    const provider: AIProvider = {
      request: async (): Promise<ProviderResponse> => ({
        text: JSON.stringify({
          compatible: false,
          reason:
            "Respondent A says win the centres first; Respondent B says the parent is the human. " +
            "These say opposite things about who the customer is.",
        }),
        inputTokens: 10,
        outputTokens: 5,
        model: "pinned-model",
      }),
    };
    const gateway: GatewayContext = {
      purpose: "synthesis",
      pin: "L0",
      budgetExhausted: false,
      circuitOpen: false,
      latencyDegraded: false,
      timeoutMs: 20,
      retryBackoffMs: 0,
      record: {
        db: db!,
        cohortId: c.cohortId,
        respondentId: c.facilitatorId,
        questionId: null,
      },
    };

    const attempt = await runClassificationAttempt(ctx, gateway, provider, "pinned-model");
    expect(attempt.served).toBe("L0");
    expect(attempt.classification?.compatible).toBe(false);
    expect(attempt.classification?.reason).toContain("Respondent A");

    // The classification is a distinct call with its own logged interaction row
    // (acceptance 1): exactly one row, purpose 'synthesis', question_id null.
    const { rows } = await db!.query<{
      purpose: string;
      question_id: string | null;
      level: string;
    }>(
      `select purpose, question_id, level
         from ai_interactions
        where cohort_id = $1 and purpose = 'synthesis'`,
      [c.cohortId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].purpose).toBe("synthesis");
    expect(rows[0].question_id).toBeNull();
    expect(rows[0].level).toBe("L0");
  });
});