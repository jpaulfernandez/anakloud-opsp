// The printed OPSP sheet's header content (F08-T02, FR-27, tech_infrastructure
// §7, ui_ux §4.16). Pure, no I/O, no network: the em-dash draft label and the
// export timestamp are deterministic strings so they can be unit-tested and so
// the interactive OPSP view and the print route (which must produce visually
// equivalent documents, F08-T03) render the same text. The label is the exact
// FR-23 / §4.16 wording — this tool asks people to treat their plan as a draft,
// and the printed sheet is where that boundary matters most, so the label is
// reproduced verbatim rather than paraphrased.

export const PRINT_DRAFT_LABEL = "Your draft — not the company's plan";

// F15-T07 — the printed official OPSP sheet's label (FR-42, tech_infrastructure
// §4, ui_ux §4.20). Unlike the respondent's own plan, the official canvas is
// the company's plan, so the export header carries that identity rather than
// the FR-23 "Your draft — not the company's plan" wording. Same deterministic
// string, same header line, so the official print sheet and its PDF export
// agree by construction, exactly as the individual print route does.
export const OFFICIAL_PRINT_LABEL = "Official One-Page Strategic Plan";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The timestamp printed beside the draft label, e.g. "Generated 17 Aug 2026,
 * 09:05". Built from the date's local components so the stamp reflects the
 * respondent's own timezone, which on the interactive view is when they asked
 * to save and on the print route is when the sheet was rendered.
 */
export function formatExportTimestamp(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `Generated ${day} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hour}:${minute}`;
}