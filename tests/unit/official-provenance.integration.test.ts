import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { withRespondentContext } from "../../lib/access";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  acceptOfficialCellDraft,
  createOfficialDraftVersion,
  getOrCreateOfficialDraft,
  latestOfficialDraft,
  storeOfficialCellDraft,
  type OfficialCellProvenance,
} from "../../lib/official-opsp";
import { attachSourceCard } from "../../lib/official-source-cards";

// F15-T06 acceptance against a real Postgres: an accepted official cell records
// which respondents' answers fed it and from which questions; that provenance
// lives on the cell, so it survives a reload and a later version snapshot
// (a further edit) untouched. The synthesis path is exercised by attaching real
// source cards to a cell, storing a draft, and accepting it; decision-resolved
// provenance is already pinned in official-draft.integration.test.ts (F15-T05).
// Like the other DB suites these skip unless the operator opts in (DATABASE_URL
// set AND RUN_DB_TESTS=1).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

describe.skipIf(!enabled)("official OPSP cell provenance (F15-T06)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `official_prov_test_${Date.now()}`;
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

  /** Seed an isolated cohort with a facilitator and two q7-answering members. */
  async function makeCohort(): Promise<{
    cohortId: string;
    facilitatorId: string;
    ernId: string;
    paulId: string;
  }> {
    const cohortId = randomUUID();
    const facilitatorId = randomUUID();
    const ernId = randomUUID();
    const paulId = randomUUID();
    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Team', 'Q4 2026', 'open')`,
      [cohortId],
    );
    await db!.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', $3, 'OFP RF', true)`,
      [facilitatorId, cohortId, `token-fac-${cohortId}`],
    );
    for (const [rid, name, code] of [
      [ernId, "Ern", "OFPE"],
      [paulId, "Paul", "OFPP"],
    ] as const) {
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code)
         values ($1, $2, $3, $4, $5)`,
        [rid, cohortId, name, `token-${code}-${cohortId}`, `${code}1`],
      );
      await db!.query(
        `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
         values ($1, $2, 'q7', $3::jsonb, false, null)`,
        [randomUUID(), rid, JSON.stringify({ text: `${name}'s brand promise` })],
      );
    }
    return { cohortId, facilitatorId, ernId, paulId };
  }

  it("records which respondents' answers fed an accepted synthesis cell, and it survives a snapshot", async () => {
    const c = await makeCohort();
    await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);

    // Attach Ern's and Paul's q7 answers as the two source cards that feed the
    // synthesis, then store the AI-drafted statement and accept it.
    await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "brand_promise",
      respondentId: c.ernId,
      questionId: "q7",
    });
    await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "brand_promise",
      respondentId: c.paulId,
      questionId: "q7",
    });
    await storeOfficialCellDraft(db!, c.facilitatorId, c.cohortId, "brand_promise", {
      id: randomUUID(),
      statement: "A clinic with a name parents already trust.",
      sourceQuestionIds: ["q7"],
    });
    const accepted = await acceptOfficialCellDraft(
      db!,
      c.facilitatorId,
      c.cohortId,
      "brand_promise",
    );

    const cell = accepted.cells.brand_promise;
    expect(cell.value).toBe("A clinic with a name parents already trust.");
    expect(cell.sources).toEqual(["q7"]);
    // F15-T06 — the accepted cell names which respondents fed it, not just the
    // question: Ern and Paul, both from q7, in attachment order.
    expect(cell.provenance).toEqual<OfficialCellProvenance[]>([
      { respondentId: c.ernId, respondentName: "Ern", questionId: "q7" },
      { respondentId: c.paulId, respondentName: "Paul", questionId: "q7" },
    ]);

    // Provenance survives a reload of the same lineage.
    const read = await withRespondentContext(db!, c.facilitatorId, (tx) =>
      latestOfficialDraft(tx, c.cohortId),
    );
    expect(read?.cells.brand_promise.provenance).toEqual([
      { respondentId: c.ernId, respondentName: "Ern", questionId: "q7" },
      { respondentId: c.paulId, respondentName: "Paul", questionId: "q7" },
    ]);
  });

  it("retains provenance across a later version snapshot (editing the cell)", async () => {
    const c = await makeCohort();
    await getOrCreateOfficialDraft(db!, c.facilitatorId, c.cohortId);

    await attachSourceCard(db!, c.facilitatorId, c.cohortId, {
      cellId: "purpose",
      respondentId: c.ernId,
      questionId: "q7",
    });
    await storeOfficialCellDraft(db!, c.facilitatorId, c.cohortId, "purpose", {
      id: randomUUID(),
      statement: "Nobody waits alone.",
      sourceQuestionIds: ["q7"],
    });
    await acceptOfficialCellDraft(db!, c.facilitatorId, c.cohortId, "purpose");
    expect(
      (await withRespondentContext(db!, c.facilitatorId, (tx) =>
        latestOfficialDraft(tx, c.cohortId),
      ))?.cells.purpose.provenance,
    ).toHaveLength(1);

    // A later facilitator edit writes a new version; the accepted cell's
    // provenance must ride along unchanged rather than being dropped.
    const edited = await createOfficialDraftVersion(db!, c.facilitatorId, c.cohortId, {
      cellId: "purpose",
      content: "Nobody waits for a diagnosis alone.",
      mark: "ink",
    });
    expect(edited.cells.purpose.provenance).toEqual([
      { respondentId: c.ernId, respondentName: "Ern", questionId: "q7" },
    ]);

    // And it survives a reload after the edit too — the snapshotted version and
    // the reloaded latest both carry it.
    const read = await withRespondentContext(db!, c.facilitatorId, (tx) =>
      latestOfficialDraft(tx, c.cohortId),
    );
    expect(read?.cells.purpose.provenance).toEqual([
      { respondentId: c.ernId, respondentName: "Ern", questionId: "q7" },
    ]);
  });
});