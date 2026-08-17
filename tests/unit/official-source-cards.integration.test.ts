import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import type { QuestionId } from "../../lib/questions";
import {
  attachSourceCard,
  listSourceCardCandidates,
  removeSourceCard,
  SourceCardUnavailableError,
} from "../../lib/official-source-cards";
import {
  emptyOfficialCells,
  getOrCreateOfficialDraft,
  latestOfficialDraft,
} from "../../lib/official-opsp";

// F15-T02 acceptance against a real Postgres: the facilitator can attach any
// respondent's public answer to a cell as an attributed source card, q14d never
// appears in the picker, and removing a card leaves the underlying answer
// untouched. Like the other DB suites these skip unless the operator opts in
// (DATABASE_URL set AND RUN_DB_TESTS=1). The RLS facilitator-only guarantee for
// official drafts is already asserted in official-opsp.integration.test.ts;
// this file focuses on the source-card behaviours themselves. Every test seeds
// a fresh cohort so drafts never accumulate across tests.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

/** The private q14 note row — this must never reach the picker or a card. */
const Q14D = "q14d";

describe.skipIf(!enabled)("official OPSP source cards (F15-T02)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_sc_test_${Date.now()}`;
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
   * Seed an isolated cohort with a facilitator, a respondent who answered q7,
   * and that respondent's private q14 note. Returns the cohort's ids.
   */
  async function makeCohort(): Promise<{
    cohortId: string;
    facilitatorId: string;
    respondentId: string;
  }> {
    const cohortId = randomUUID();
    const facilitatorId = randomUUID();
    const respondentId = randomUUID();
    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Team', 'Q4 2026', 'open')`,
      [cohortId],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', $3, 'OFSCF', true)`,
      [facilitatorId, cohortId, `token-fac-${cohortId}`],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent A', $3, 'OFSCA')`,
      [respondentId, cohortId, `token-a-${cohortId}`],
    );
    await db!.query(
      `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
       values ($1, $2, 'q7', $3::jsonb, false, null)`,
      [randomUUID(), respondentId, JSON.stringify({ text: "Brand clarity above all" })],
    );
    await db!.query(
      `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
       values ($1, $2, $3, $4::jsonb, true, null)`,
      [randomUUID(), respondentId, Q14D, JSON.stringify({ private_note: "I might step back in April." })],
    );
    return { cohortId, facilitatorId, respondentId };
  }

  it("the picker shows the respondent's public answer and never q14d", async () => {
    const c = await makeCohort();
    await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);
    const candidates = await listSourceCardCandidates(db!, c.facilitatorId, c.cohortId);

    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) expect(candidate.questionId).not.toBe(Q14D);

    const q7 = candidates.find(
      (candidate) => candidate.questionId === "q7" && candidate.respondentId === c.respondentId,
    );
    expect(q7).toBeDefined();
    expect(q7!.respondentName).toBe("Respondent A");
    expect(q7!.text).toContain("Brand clarity above all");
  });

  it("attaches a respondent's answer as an attributed card on a cell", async () => {
    const c = await makeCohort();
    const before = await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);
    const result = await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "bhag",
      respondentId: c.respondentId,
      questionId: "q7",
    });

    expect(result.version).toBe(before.version + 1);
    const card = result.cells.bhag.sourceCards[0];
    expect(card).toBeDefined();
    expect(card.questionId).toBe("q7");
    expect(card.respondentName).toBe("Respondent A");
    expect(card.text).toContain("Brand clarity above all");
  });

  it("removing a card leaves the underlying answer untouched (PR5)", async () => {
    const c = await makeCohort();
    await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);

    // Attach two cards so removing one leaves the other visible.
    await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "bhag",
      respondentId: c.respondentId,
      questionId: "q7",
    });
    const withTwo = await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "bhag",
      respondentId: c.respondentId,
      questionId: "q7",
    });
    expect(withTwo.cells.bhag.sourceCards).toHaveLength(2);

    const removed = await removeSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "bhag",
      cardId: withTwo.cells.bhag.sourceCards[0].id,
    });
    expect(removed.cells.bhag.sourceCards).toHaveLength(1);

    // The answers table row is byte-for-byte unchanged.
    await withRespondentContext(db!, c.facilitatorId, async (tx) => {
      const { rows } = await tx.query<{ value: unknown }>(
        `select value from answers
          where respondent_id = $1 and question_id = 'q7'`,
        [c.respondentId],
      );
      expect(rows[0].value).toEqual({ text: "Brand clarity above all" });
      const { rows: injected } = await tx.query<{ n: number }>(
        `select count(*)::int as n from answers
          where respondent_id = $1 and question_id = $2`,
        [c.respondentId, Q14D],
      );
      // The private note still exists, just never surfaced in the picker.
      expect(injected[0].n).toBe(1);
    });
  });

  it("refuses to attach the private q14d row", async () => {
    const c = await makeCohort();
    const before = await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);
    await expect(
      attachSourceCard(db!, c.facilitatorId, c.cohortId, {
        cellId: "bhag",
        respondentId: c.respondentId,
        questionId: Q14D as QuestionId,
      }),
    ).rejects.toBeInstanceOf(SourceCardUnavailableError);
    // Nothing was written — the draft version is unchanged.
    const after = await latestOfficialDraft(db!, c.cohortId);
    expect(after!.version).toBe(before.version);
    expect(after!.cells.bhag.sourceCards).toHaveLength(0);
  });

  it("refuses to attach a missing or foreign-answer source", async () => {
    const c = await makeCohort();
    await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);
    await expect(
      attachSourceCard(db!, c.facilitatorId, c.cohortId, {
        cellId: "bhag",
        // A respondent with no answers, so no non-private source matches.
        respondentId: c.facilitatorId,
        questionId: "q7",
      }),
    ).rejects.toBeInstanceOf(SourceCardUnavailableError);
  });

  it("normalises legacy official cells (no sourceCards) so attach still works", async () => {
    const c = await makeCohort();
    const created = await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);
    // Simulate a pre-F15-T02 version-1 row whose cells carry no sourceCards
    // (all sixteen still present, as F15-T01 always wrote them).
    const legacy = Object.fromEntries(
      Object.entries(emptyOfficialCells()).map(([id, cell]) => {
        const { sourceCards, ...rest } = cell;
        return [id, rest];
      }),
    );
    await db!.query(
      `update opsp_drafts set cells = $2::jsonb
        where owner_type = 'official' and cohort_id = $1 and version = 1`,
      [c.cohortId, JSON.stringify(legacy)],
    );
    const result = await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "bhag",
      respondentId: c.respondentId,
      questionId: "q7",
    });
    expect(result.version).toBe(created.version + 1);
    expect(result.cells.bhag.sourceCards).toHaveLength(1);
  });
});