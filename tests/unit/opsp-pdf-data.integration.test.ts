import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import { loadOpspPrintSheet } from "../../lib/opsp-pdf";
import { formatOpspCellValue } from "../../lib/opsp-view";
import { OPSP_CELL_IDS } from "../../lib/opsp";

// F08-T04 — private exclusion in the PDF data path, against a real Postgres.
// Like the other `*.integration.test.ts` files this runs only when the
// operator opts in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), so `./verify.sh`
// stays green without a database. Each run works in its own temporary schema
// and drops it afterwards.
//
// The two acceptance checks that need actual data:
//   * a respondent with a populated Q14(d) produces a printable sheet with
//     none of that text (AC1);
//   * the facilitator exporting another respondent's plan also gets no private
//     content (AC2, spec.md §8 "Q14(d) never leaves the database except on the
//     facilitator's own screen" — the note is not on a PDF, even the
//     facilitator's export of a cohort mate).
// Both are guaranteed because loadOpspPrintSheet reads through
// listPublicAnswers, whose SQL filters is_private = false. Acting as the
// facilitator is what makes the second case meaningful: under RLS the
// facilitator can read cohort-wide answers, so it is the SQL filter alone that
// keeps the note out.
const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "55555555-5555-5555-5555-555555555555";
const RESPONDENT = "66666666-6666-6666-6666-666666666666";
const FACILITATOR = "77777777-7777-7777-7777-777777777777";
const PRIVATE_NOTE =
  "If we are still unpaid by March I will need to take a job. I don't know how to bring it up.";

describe.skipIf(!enabled)("F08-T04 — PDF data path private exclusion", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `opsp_pdf_data_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await db.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent', 'token-q14', 'Q14ABC')`,
      [RESPONDENT, COHORT],
    );
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
       values ($1, $2, 'Facilitator', 'token-fac', 'FAC123', true)`,
      [FACILITATOR, COHORT],
    );

    // A full Q14 with a private note plus a Q15 answer, so the plan is
    // non-trivial and the note is genuinely a populated Q14(d) row.
    await withRespondentContext(db!, RESPONDENT, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q14",
        value: {
          wants: ["product"],
          others: { "44444444-4444-4444-4444-444444444444": "product" },
          hours: 30,
          private_note: PRIVATE_NOTE,
        },
      }),
    );
    await withRespondentContext(db!, RESPONDENT, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q15",
        value: { text: "Ship the beta by September." },
      }),
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("a respondent's own printable sheet contains none of their Q14(d) note", async () => {
    const cells = await withRespondentContext(db!, RESPONDENT, (tx) =>
      loadOpspPrintSheet(tx, RESPONDENT),
    );

    // Neither the note's text nor any "q14d"-keyed data survives into the
    // sheet the PDF renders. Exclusion happens in the query (listPublicAnswers)
    // and the mapping never touches the note.
    const serialized = JSON.stringify(cells);
    expect(serialized.includes("q14d")).toBe(false);
    expect(serialized.includes(PRIVATE_NOTE)).toBe(false);

    // The Q14-derived cells (Accountability / FACe, Capacity) still render the
    // public fields the plan legitimately carries.
    const accountability = formatOpspCellValue(cells.accountability_face.value);
    const capacity = formatOpspCellValue(cells.capacity.value);
    expect(accountability).toContain("Wants to own: product");
    expect(capacity).toContain("Hours a week: 30");
    expect([accountability, capacity].join("\n")).not.toContain(PRIVATE_NOTE);
  });

  it("a facilitator exporting another respondent's plan also gets no private content", async () => {
    // Acting as the facilitator, who can read cohort-wide answers including
    // private rows, the sheet for a cohort mate is still built from
    // listPublicAnswers — so the PDF they generate carries none of the note.
    const cells = await withRespondentContext(db!, FACILITATOR, (tx) =>
      loadOpspPrintSheet(tx, RESPONDENT),
    );

    const serialized = JSON.stringify(cells);
    expect(serialized.includes("q14d")).toBe(false);
    expect(serialized.includes(PRIVATE_NOTE)).toBe(false);
  });

  it("always builds all sixteen cells so the sheet is complete", async () => {
    const cells = await withRespondentContext(db!, RESPONDENT, (tx) =>
      loadOpspPrintSheet(tx, RESPONDENT),
    );
    for (const id of OPSP_CELL_IDS) expect(id in cells).toBe(true);
  });
});