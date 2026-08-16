// The printed OPSP sheet's header content (F08-T02, FR-27, tech_infrastructure
// §7, ui_ux §4.16). Pure, no I/O, no network: the em-dash draft label and the
// export timestamp are deterministic strings so they can be unit-tested and so
// the interactive OPSP view and the print route (which must produce visually
// equivalent documents, F08-T03) render the same text. The label is the exact
// FR-23 / §4.16 wording — this tool asks people to treat their plan as a draft,
// and the printed sheet is where that boundary matters most, so the label is
// reproduced verbatim rather than paraphrased.

export const PRINT_DRAFT_LABEL = "Your draft — not the company's plan";

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