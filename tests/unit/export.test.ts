import { describe, expect, it } from "vitest";
import type { CohortAnswerRow } from "../../lib/answers";
import { CSV_BOM, serializeCsv } from "../../lib/csv";
import {
  buildExportTable,
  includePrivateRequested,
  PRIVATE_NOTE_HEADER,
  type ExportQuestionCategory,
} from "../../lib/export";

// F10-T05 — the CSV export table and its privacy guarantee. The default export
// must carry no Q14(d) content (acceptance 1), Taglish and multi-line answers
// must survive a spreadsheet round trip (acceptance 2), and private rows must
// be released only for an explicitly re-confirmed request. The table builder
// is pure, so all three are asserted here without a database; the re-confirm
// reconciliation (`includePrivateRequested`) is pure and lives here too.

/** A minimal RFC 4180 parser used as the "spreadsheet" in the round trip. */
function parseCsv(text: string): string[][] {
  const body = text.startsWith(CSV_BOM) ? text.slice(CSV_BOM.length) : text;
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

const R1 = "20000000-0000-0000-0000-000000000001";
const R2 = "20000000-0000-0000-0000-000000000002";
const ANA = "Ana Reyes";
const BEN = "Benito Cruz";

const PRIVATE_NOTE = "I may need to leave by March.";

const MULTILINE_Q1 =
  "Para sa mga batang naghihintay ng tulong.\nHindi dapat distansya ang magdesisyon kung sino ang makakatanggap ng pangangalaga.";

function row(
  rId: string,
  name: string,
  email: string | null,
  qid: string,
  value: unknown,
  confidence: number | null = null,
): CohortAnswerRow {
  return {
    respondent_id: rId,
    respondent_name: name,
    respondent_email: email,
    question_id: qid,
    value,
    confidence,
  };
}

// Deliberately conflicting answers: open text (q1), closed+confidence q3/q10,
// a closed non-confidence q14, and Ana's private note (no note for Ben).
const FIXTURE: CohortAnswerRow[] = [
  row(R1, ANA, "ana@anakloud.ph", "q1", { text: MULTILINE_Q1 }),
  row(R1, ANA, "ana@anakloud.ph", "q3", { metric: "paying centers", value: 300, unit: "paying_centers", why: "adoption" }, 3),
  row(R1, ANA, "ana@anakloud.ph", "q10", { payer: "center", model: "monthly subscription", amount: 2500, unit: "per center", first_peso: "2027-01" }, 1),
  row(R1, ANA, "ana@anakloud.ph", "q14", { wants: ["product"], others: { [R2]: "backend" }, hours: 30 }),
  row(R1, ANA, "ana@anakloud.ph", "q14d", { private_note: PRIVATE_NOTE }),

  row(R2, BEN, "ben@anakloud.ph", "q1", { text: "The record lives in six places and nobody can read it." }),
  row(R2, BEN, "ben@anakloud.ph", "q3", { metric: "renewals", value: 80, unit: "renewals", why: "retention" }, 3),
  row(R2, BEN, "ben@anakloud.ph", "q10", { payer: "center", model: "per active child", amount: 200, unit: "per child", first_peso: "2026-11" }, 2),
  row(R2, BEN, "ben@anakloud.ph", "q14", { wants: ["backend"], others: { [R1]: "product" }, hours: 20 }),
];

const Q1_MANUAL: ExportQuestionCategory = { questionId: "q1", category: "manual review" };
const Q3_ALIGNED: ExportQuestionCategory = { questionId: "q3", category: "aligned" };
const Q10_SOFT: ExportQuestionCategory = { questionId: "q10", category: "soft split" };
const Q8_HARD: ExportQuestionCategory = { questionId: "q8", category: "hard split" };
// q14 is closed but non-confidence (FR-31): no Part C category.
const Q14_NONE: ExportQuestionCategory = { questionId: "q14", category: null };

const CATEGORIES = [Q1_MANUAL, Q3_ALIGNED, Q8_HARD, Q10_SOFT, Q14_NONE];

/** Locate a column's index in the exported header, or -1. */
function columnIndex(header: string[], name: string): number {
  return header.indexOf(name);
}

describe("includePrivateRequested (F10-T05)", () => {
  it("defaults to a public export without any params", () => {
    expect(includePrivateRequested(new URLSearchParams())).toBe(false);
  });

  it("releases private rows only when includePrivate AND confirmPrivate are both explicit", () => {
    const qs = (s: string) => new URLSearchParams(s);
    expect(includePrivateRequested(qs("includePrivate=true"))).toBe(false);
    expect(includePrivateRequested(qs("confirmPrivate=true"))).toBe(false);
    expect(includePrivateRequested(qs("includePrivate=true&confirmPrivate=true"))).toBe(true);
    // The numbers "1" are accepted; anything else is not a confirmation.
    expect(includePrivateRequested(qs("includePrivate=1&confirmPrivate=1"))).toBe(true);
    expect(includePrivateRequested(qs("includePrivate=true&confirmPrivate=1"))).toBe(true);
    expect(includePrivateRequested(qs("includePrivate=1&confirmPrivate=false"))).toBe(false);
    expect(includePrivateRequested(qs("includePrivate=TRUE&confirmPrivate=true"))).toBe(false);
  });
});

describe("buildExportTable (F10-T05)", () => {
  it("default export carries no q14.d column and no private content", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, false);
    const [header, ...rows] = parseCsv(serializeCsv(table));
    expect(columnIndex(header, PRIVATE_NOTE_HEADER)).toBe(-1);

    const flat = [header, ...rows].flat().join(" ");
    expect(flat).not.toContain(PRIVATE_NOTE);

    // Locate each respondent's q14 cell and confirm the note never slipped in.
    const q14Idx = columnIndex(header, "q14");
    for (const r of rows) expect(r[q14Idx]).not.toContain(PRIVATE_NOTE);
  });

  it("confirmed private export adds the q14.d column with the note for its owner only", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, true);
    const [header, ...rows] = parseCsv(serializeCsv(table));
    const noteIdx = columnIndex(header, PRIVATE_NOTE_HEADER);
    expect(noteIdx).toBeGreaterThan(columnIndex(header, "q14"));

    const ana = rows.find((r) => r[0] === ANA)!;
    const ben = rows.find((r) => r[0] === BEN)!;
    expect(ana[noteIdx]).toBe(PRIVATE_NOTE);
    // Ben has no private note; the cell is empty, not a fabricated value.
    expect(ben[noteIdx]).toBe("");

    // The note is in q14.d only, never doubled into the public q14 cell.
    const q14Idx = columnIndex(header, "q14");
    expect(ana[q14Idx]).not.toContain(PRIVATE_NOTE);
  });

  it("places the private note column directly after the q14 group", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, true);
    const [header] = parseCsv(serializeCsv(table));
    const q14Idx = columnIndex(header, "q14");
    const noteIdx = columnIndex(header, PRIVATE_NOTE_HEADER);
    // After q14, q14 confidence, q14 divergence comes the note column.
    expect(header.slice(q14Idx, noteIdx + 1)).toEqual([
      "q14",
      "q14 confidence",
      "q14 divergence",
      PRIVATE_NOTE_HEADER,
    ]);
  });

  it("includes confidence values where a question carries them", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, false);
    const [header, ...rows] = parseCsv(serializeCsv(table));
    const q3ConfIdx = columnIndex(header, "q3 confidence");
    const q10ConfIdx = columnIndex(header, "q10 confidence");
    const ana = rows.find((r) => r[0] === ANA)!;
    const ben = rows.find((r) => r[0] === BEN)!;
    expect(ana[q3ConfIdx]).toBe("3");
    expect(ben[q3ConfIdx]).toBe("3");
    expect(ana[q10ConfIdx]).toBe("1");
    expect(ben[q10ConfIdx]).toBe("2");
  });

  it("includes divergence classifications per question", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, false);
    const [header, ...rows] = parseCsv(serializeCsv(table));
    const q1Div = columnIndex(header, "q1 divergence");
    const q3Div = columnIndex(header, "q3 divergence");
    const q8Div = columnIndex(header, "q8 divergence");
    const q10Div = columnIndex(header, "q10 divergence");
    const q14Div = columnIndex(header, "q14 divergence");
    const ana = rows.find((r) => r[0] === ANA)!;
    expect(ana[q1Div]).toBe("Manual review");
    expect(ana[q3Div]).toBe("Aligned");
    expect(ana[q8Div]).toBe("Hard split");
    expect(ana[q10Div]).toBe("Soft split");
    // Non-confidence closed question has no Part C category.
    expect(ana[q14Div]).toBe("");
  });

  it("round-trips multi-line and Taglish answer text intact", () => {
    const table = buildExportTable(FIXTURE, CATEGORIES, false);
    const [header, ...rows] = parseCsv(serializeCsv(table));
    const q1Idx = columnIndex(header, "q1");
    const ana = rows.find((r) => r[0] === ANA)!;
    // The exact multi-line Taglish body survives the write→parse round trip,
    // line break and accents intact — the spreadsheet can read it as one cell.
    expect(ana[q1Idx]).toContain("\n");
    expect(ana[q1Idx]).toBe(MULTILINE_Q1);
  });
});