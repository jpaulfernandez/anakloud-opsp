import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import {
  fetchExportCsv,
  PRIVATE_NOTE_HEADER,
} from "../../lib/export";
import { migrate } from "../../lib/migrate";

// F10-T05 — the CSV export data path against a real Postgres. Runs only when
// opted in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), inside a temporary schema
// it drops afterwards — the same pattern as the other DB tests.
//
// Proves the acceptances that need a database: the default export contains no
// Q14(d) content (the note is excluded at the query layer even though the
// facilitator's RLS could see it), the re-confirmed private export includes it
// and records the event in `export_events`, and an ordinary public export is
// not logged.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "dddd1111-dddd-1111-dddd-111111111501";
const FACILITATOR = "dddd1111-dddd-1111-dddd-111111111502";
const ANA = "dddd1111-dddd-1111-dddd-111111111503";
const BEN = "dddd1111-dddd-1111-dddd-111111111504";

const ANA_NAME = "Ana Reyes";
const BEN_NAME = "Benito Cruz";

// Must never appear in the default export; must appear (and be logged) only in
// the re-confirmed private export.
const PRIVATE_NOTE = "I may need to step back after March.";

/** A minimal RFC 4180 parser used as the "spreadsheet" in the round trip. */
function parseCsv(text: string): string[][] {
  const body = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < body.length) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

function columnIndex(header: string[], name: string): number {
  return header.indexOf(name);
}

describe.skipIf(!enabled)("CSV export against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `export_test_${Date.now()}`;
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
    // The facilitator is unsubmitted here — fetchExportCsv is called directly,
    // so the route's F09-T01 gate is not exercised (it is covered elsewhere).
    await respondent(FACILITATOR, "Lia Mendoza", "lia@anakloud.ph", "token-exp-fac", "EXPFC", true);
    await respondent(ANA, ANA_NAME, "ana@anakloud.ph", "token-exp-ana", "EXPA1");
    await respondent(BEN, BEN_NAME, "ben@anakloud.ph", "token-exp-ben", "EXPB2");

    const write = (r: string, q: string, value: object, confidence?: number) =>
      withRespondentContext(db!, r, (tx) =>
        upsertAnswer(tx, {
          respondent_id: r,
          question_id: q,
          value,
          confidence: confidence ?? null,
        }),
      );

    await write(ANA, "q1", { text: "Para sa mga bata.\nHindi dapat distansya ang magdesisyon." });
    await write(BEN, "q1", { text: "The record lives in six places." });

    // Q3 closed + confidence: two units → the divergence column must say Soft split.
    await write(ANA, "q3", { metric: "paying centers", value: 300, unit: "paying_centers", why: "adoption" }, 2);
    await write(BEN, "q3", { metric: "paying centers", value: 350, unit: "visits", why: "use" }, 3);

    // Ana has a private note; Ben does not.
    await write(ANA, "q14", {
      wants: ["product"],
      others: { [BEN]: "backend" },
      hours: 30,
      private_note: PRIVATE_NOTE,
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

  it("default export contains no Q14(d) content and is not logged", async () => {
    const csv = await fetchExportCsv(db!, FACILITATOR, COHORT, false);
    const [header, ...rows] = parseCsv(csv);

    // No private-note column exists at all.
    expect(columnIndex(header, PRIVATE_NOTE_HEADER)).toBe(-1);
    // The note text appears nowhere in the flattened file.
    const flat = [header, ...rows].flat().join(" ");
    expect(flat).not.toContain(PRIVATE_NOTE);

    // Both respondents appear, with the public q14 content but never the note.
    const q14Idx = columnIndex(header, "q14");
    const anaRow = rows.find((r) => r[0] === ANA_NAME)!;
    const benRow = rows.find((r) => r[0] === BEN_NAME)!;
    expect(anaRow[q14Idx]).toContain("Wants to own");
    expect(benRow[q14Idx]).toContain("Wants to own");
    expect(anaRow[q14Idx]).not.toContain(PRIVATE_NOTE);

    // Taglish multi-line survives; divergence columns carry the verdict.
    const q1Idx = columnIndex(header, "q1");
    const q1Div = columnIndex(header, "q1 divergence");
    const q3Div = columnIndex(header, "q3 divergence");
    expect(anaRow[q1Idx]).toContain("\n");
    expect(anaRow[q1Idx]).toContain("Para sa mga bata.");
    expect(anaRow[q3Div]).toBe("Soft split");
    expect(anaRow[q1Div]).toBe("Manual review");

    // A public export is not a private release, so nothing is recorded.
    const { rows: events } = await db!.query(
      "select id from export_events where cohort_id = $1",
      [COHORT],
    );
    expect(events).toHaveLength(0);
  });

  it("re-confirmed private export includes Q14(d) and records the event", async () => {
    const csv = await fetchExportCsv(db!, FACILITATOR, COHORT, true);
    const [header, ...rows] = parseCsv(csv);
    const noteIdx = columnIndex(header, PRIVATE_NOTE_HEADER);
    expect(noteIdx).toBeGreaterThan(-1);

    const anaRow = rows.find((r) => r[0] === ANA_NAME)!;
    const benRow = rows.find((r) => r[0] === BEN_NAME)!;
    expect(anaRow[noteIdx]).toBe(PRIVATE_NOTE);
    // The owner-less respondent's note cell stays empty.
    expect(benRow[noteIdx]).toBe("");

    // The note lives only in the q14.d cell, never the public q14 cell.
    const q14Idx = columnIndex(header, "q14");
    expect(anaRow[q14Idx]).not.toContain(PRIVATE_NOTE);

    // The release is recorded once, attributed to the acting facilitator.
    const { rows: events } = await db!.query(
      `select acted_by, included_private from export_events where cohort_id = $1`,
      [COHORT],
    );
    expect(events).toHaveLength(1);
    expect(events[0].acted_by).toBe(FACILITATOR);
    expect(events[0].included_private).toBe(true);
  });
});