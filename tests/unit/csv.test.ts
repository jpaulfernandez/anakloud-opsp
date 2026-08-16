import { describe, expect, it } from "vitest";
import { csvCell, CSV_BOM, serializeCsv } from "../../lib/csv";

// F10-T05 — the CSV serializer (RFC 4180). The acceptance "Taglish and
// multi-line answers survive a round trip through a spreadsheet" is a parser
// round-trip here: serialize and then parse back, comparing cell-for-cell.
// The browser's save-as and a spreadsheet's read both go through this same
// field escaping, so the unit test is the spreadsheet; there is nothing to
// defer to a browser.

/** A minimal RFC 4180 parser: splits one field at a time, honoring quoting. */
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
      // Swallow the \r of a CRLF record terminator.
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

const TAGLISH = "Ginawa namin ito para sa mga batang naghihintay ng tulong.";

describe("csvCell (F10-T05)", () => {
  it("passes plain ASCII through unquoted", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null and undefined as empty cells", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes a field that contains a comma", () => {
    expect(csvCell("a, b")).toBe('"a, b"');
  });

  it("doubles embedded double-quotes inside a quoted field", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes a field that contains a newline and preserves it", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });

  it("passes non-ASCII (Taglish) text through intact", () => {
    expect(csvCell(TAGLISH)).toBe(TAGLISH);
  });
});

describe("serializeCsv (F10-T05)", () => {
  it("prepends a UTF-8 BOM so spreadsheets detect the encoding", () => {
    expect(serializeCsv([["a"]])).toBe(`${CSV_BOM}a\r\n`);
  });

  it("joins rows and columns with CRLF and commas, ending in a newline", () => {
    const csv = serializeCsv([
      ["name", "q"],
      ["Ana", "yes"],
    ]);
    const body = csv.slice(CSV_BOM.length);
    expect(body).toBe("name,q\r\nAna,yes\r\n");
  });

  it("round-trips multi-line and Taglish text through a parse", () => {
    const story = "Sabi ni J,\nmaayos natin 'yan.\nKaya natin 'to, sabi niya.";
    const table = [
      ["respondent", "email", "q15"],
      ["Ana", "ana@anakloud.ph", story],
      ["Ben", "ben@anakloud.ph", TAGLISH],
    ];
    const rows = parseCsv(serializeCsv(table));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["respondent", "email", "q15"]);
    expect(rows[1]).toEqual(["Ana", "ana@anakloud.ph", story]);
    expect(rows[2]).toEqual(["Ben", "ben@anakloud.ph", TAGLISH]);
  });

  it("round-trips fields containing commas and quotes", () => {
    const tricky = 'she said "no, not that" then paused';
    const rows = parseCsv(serializeCsv([["c1", "c2", "c3"], [tricky, "a,b", "plain"]]));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual([tricky, "a,b", "plain"]);
  });

  it("renders null cells as empty and leaves them parseable", () => {
    const rows = parseCsv(serializeCsv([["a", "b", "c"], [null, "x", undefined]]));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["", "x", ""]);
  });
});