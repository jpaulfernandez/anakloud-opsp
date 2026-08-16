// RFC 4180 CSV serialization for the facilitator export (F10-T05, FR-34).
// Pure: no I/O, no network, so the escaping rules are unit-testable without a
// browser — the same discipline as the validators and the divergence scorer.
//
// A cell must be quoted when it contains a comma, a double-quote or a newline;
// an embedded quote is doubled inside the quoted field. Answer text is
// multi-line (q15's story, q11's rows), and Taglish is non-ASCII, so both must
// survive the trip into a spreadsheet byte-for-byte — asserted by parsing the
// serialized output back in the unit test. Rows join with CRLF (RFC 4180) so
// Excel-style consumers see one record per line, and the output carries a
// UTF-8 byte-order mark so width-aware spreadsheets detect the encoding
// instead of guessing (Taglish accents garble when mis-detected as Latin-1).

/** One cell value in a CSV table. Null/undefined render as an empty cell. */
export type CsvCell = string | number | null | undefined;

/** The UTF-8 BOM prefix helps Excel-style spreadsheets detect UTF-8. */
export const CSV_BOM = "\uFEFF";

/**
 * Escape and quote a single field. A field containing a comma, quote or
 * newline is wrapped in double quotes with embedded quotes doubled; everything
 * else passes through verbatim. Empty cells render as "". Always a valid cell.
 */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize a table (header row plus data rows) to RFC 4180 CSV text, prefixed
 * with the UTF-8 BOM so spreadsheets read it back as UTF-8. Every row is
 * escaped through csvCell; newlines inside a field stay inside their quoted
 * cell. Appends a trailing CRLF so the file ends on a clean record boundary.
 */
export function serializeCsv(rows: readonly (readonly CsvCell[])[]): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `${CSV_BOM}${body}${body === "" ? "" : "\r\n"}`;
}