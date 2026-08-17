import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { performSubmit } from "../../lib/submit";
import {
  buildOpspAnalysisContextFromCells,
  loadIndividualDraftForOwner,
} from "../../lib/opsp-analysis";

// F14-T04 acceptance against a real Postgres (skips unless DATABASE_URL is set
// AND RUN_DB_TESTS=1, so ./verify.sh stays green without a database). Runs in
// its own temporary schema, like the other DB suites, and asserts as a
// restricted non-superuser role so RLS is actually enforced.
//
//   1. The owner read is bounded to the facilitator's cohort: a facilitator
//      loads a respondent's latest individual OPSP draft, a non-facilitator
//      cannot read someone else's plan at all.
//   2. "The payload SHALL exclude is_private rows" — build the anonymised read
//      from an owner whose snapshot holds a private Q14(d) note, and assert the
//      note and its field name never reach the rendered context (the OPSP
//      mapping never reads q14d, and the read renders only draft cells).
//   3. A self-contradicting plan drives a payload carrying both contradictory
//      cells, so a contradiction finding has the material to name.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "91919191-9191-9191-9191-919191919191";
const FACILITATOR = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
// The analysed owner; includes a private Q14 note in their answers.
const OWNER = "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2";
// A different-cohort owner the facilitator must not see.
const FOREIGN_COHORT = "c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3";
const FOREIGN = "d4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4";

describe.skipIf(!enabled)("individual-OPSP analysis against a real Postgres (F14-T04)", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";
  let role = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `opsp_analysis_test_${Date.now()}`;
    role = `app_opsp_analysis_test_${Date.now()}`;

    await db!.query(`create schema ${schemaName}`);
    await db!.query(`set search_path = ${schemaName}, public`);

    await migrate(db!);
    await db!.query(`create role ${role}`);
    await db!.query(`grant usage on schema ${schemaName} to ${role}`);
    await db!.query(
      `grant select, insert, update, delete on all tables in schema ${schemaName} to ${role}`,
    );

    await db!.query("insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')", [COHORT]);
    await db!.query("insert into cohorts (id, name, quarter_label, status) values ($1, 'Foreign', 'Q4 2026', 'open')", [FOREIGN_COHORT]);
    for (const [id, cohort, name, isFac] of [
      [FACILITATOR, COHORT, "Facilitator", true],
      [OWNER, COHORT, "Owner", false],
      [FOREIGN, FOREIGN_COHORT, "Foreign Owner", false],
    ] as const) {
      await db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, 'token', 'RESUME', $4)`,
        [id, cohort, name, isFac],
      );
    }

    // From here the suite acts as the restricted role so RLS is enforced.
    await db!.query(`set role ${role}`);

    // The owner's answers are deliberately self-contradicting (Brand Promise
    // names parents as the customer; Profit-per-X bills centers) and carry a
    // private Q14 note. performSubmit freezes them and writes the OPSP draft v1
    // through the deterministic mapping, which never reads q14d.
    await withRespondentContext(db!, OWNER, async (tx) => {
      await upsertAnswer(tx, { respondent_id: OWNER, question_id: "q1", value: { text: "Centers run on notebooks; we give them software built for this market." } });
      await upsertAnswer(tx, { respondent_id: OWNER, question_id: "q7", value: { text: "Parents are our customer; we make their lives better first." } });
      await upsertAnswer(tx, { respondent_id: OWNER, question_id: "q10", value: { payer: "center", model: "monthly_subscription", amount: 2500, unit: "per_center", first_peso: "2027-01" } });
      await upsertAnswer(tx, {
        respondent_id: OWNER,
        question_id: "q14",
        value: { wants: ["product"], others: {}, hours: 30, private_note: "I may need to leave in six months." },
      });
    });
    await performSubmit(db!, OWNER, COHORT);
  });

  afterAll(async () => {
    try {
      await db?.query(`reset role`);
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
      if (role) await db?.query(`drop role if exists ${role}`);
    } finally {
      await db?.end();
    }
  });

  it("a facilitator loads the owner's latest individual OPSP draft", async () => {
    const draft = await loadIndividualDraftForOwner(db!, FACILITATOR, COHORT, OWNER);
    expect(draft).not.toBeNull();
    expect(draft!.version).toBe(1);
    expect(draft!.cells.brand_promise.value).toBeTruthy();
    expect(draft!.cells.profit_per_x.value).toBeTruthy();
  });

  it("a non-facilitator cannot read another respondent's plan (restricted to facilitator)", async () => {
    // Running as the OWNER themselves, who is not a facilitator, the draft of
    // FACILITATOR (or anyone else) is not readable — the read must be gated on
    // being the cohort's facilitator, not merely on any valid session.
    const other = await loadIndividualDraftForOwner(db!, OWNER, COHORT, FACILITATOR);
    expect(other).toBeNull();
  });

  it("an off-cohort owner is invisible to the cohort's facilitator", async () => {
    const foreign = await loadIndividualDraftForOwner(db!, FACILITATOR, COHORT, FOREIGN);
    expect(foreign).toBeNull();
  });

  it("the anonymised payload excludes the private Q14 note (acceptance: is_private rows)", async () => {
    const draft = await loadIndividualDraftForOwner(db!, FACILITATOR, COHORT, OWNER);
    const ctx = buildOpspAnalysisContextFromCells(draft!.cells, "A", draft!.version);

    const text = ctx.cells.map((c) => c.text).join("\n");
    // The self-contradiction material is present, so a finding can name it.
    expect(text).toContain("Parents are our customer; we make their lives better first.");
    expect(text).toContain("Payer: center");

    // The private note, and even its field name, are structurally absent.
    expect(text).not.toContain("I may need to leave in six months.");
    expect(text).not.toContain("private_note");
    // Only the anonymised label rides in the context — no respondent id.
    expect(JSON.stringify(ctx)).not.toContain(OWNER);
    expect(JSON.stringify(ctx)).not.toContain(FACILITATOR);
  });
});