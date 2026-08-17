// The individual OPSP view's presentation layer (F07-T02, FR-23, ui_ux.md
// §4.14). Pure, no I/O, no network — the sixteen cell titles, the provenance
// line and the cell-value rendering are all deterministic so they can be
// unit-tested without a browser, the same discipline as the mapping they
// present (lib/opsp.ts). Nothing here invents content: a cell's text is
// formatted only from the fragments the mapping derived from the respondent's
// own answers, and every source question's fragment reuses the same label
// resolution as the review screen (lib/review.ts) so names and roles render
// identically everywhere.
//
// The ink/pencil and empty-cell treatment is deliberately out of this module:
// F07-T03 owns it. This view renders the grid structure, the draft label and
// the provenance line the ticket requires, with cell content as readable text.

import type { OpspCell, OpspCellId } from "./opsp";
import type { OfficialCellProvenance } from "./official-opsp";
import type { DisplayNameResolver } from "./review";
import { APP_LABELS } from "./ranking";
import { Q5_COLUMNS, Q5_COLUMN_LABELS, Q5_ROLE_LABELS } from "./matrix-grid";
import { FUNCTION_LABELS } from "./q14";
import { Q6_CHOICE_LABELS } from "./single-choice-reason";

/** The sixteen Part B cell titles, in the mapping's table order. */
export const OPSP_CELL_LABELS: Record<OpspCellId, string> = {
  core_values: "Core Values",
  purpose: "Purpose",
  bhag: "Big Hairy Audacious Goal (BHAG)",
  three_year_targets: "3-Year Targets",
  sandbox_core_customer: "Sandbox — core customer",
  sandbox_boundaries: "Sandbox — boundaries",
  brand_promise: "Brand Promise",
  profit_per_x: "Profit per X",
  year1_critical_number: "1-Year Critical Number",
  key_initiatives: "Key Initiatives (1yr)",
  quarterly_theme: "Quarterly Theme",
  quarterly_rocks: "Quarterly Rocks",
  number1_priority: "The #1 Priority",
  accountability_face: "Accountability / FACe",
  swt_threats: "SWT — Threats",
  capacity: "Capacity",
};

/** One of the five strategic horizons organizing the OPSP top-to-down. */
export interface OpspHorizon {
  id: string;
  number: string;
  title: string;
  subtitle: string;
  timeframe: string;
  cellIds: readonly OpspCellId[];
}

/** The five strategic horizons in chronological and logical top-to-down sequence. */
export const OPSP_HORIZONS: readonly OpspHorizon[] = [
  {
    id: "foundation",
    number: "01",
    title: "Core Foundations",
    subtitle: "Identity & Long-term North Star",
    timeframe: "10–25 Years",
    cellIds: ["core_values", "purpose", "bhag"],
  },
  {
    id: "strategy",
    number: "02",
    title: "Strategic Horizon",
    subtitle: "Positioning & Market Boundaries",
    timeframe: "3 Years",
    cellIds: [
      "three_year_targets",
      "sandbox_core_customer",
      "sandbox_boundaries",
      "brand_promise",
    ],
  },
  {
    id: "tactics",
    number: "03",
    title: "Tactical Plan",
    subtitle: "Unit Economics & Annual Bets",
    timeframe: "1 Year",
    cellIds: ["profit_per_x", "year1_critical_number", "key_initiatives"],
  },
  {
    id: "execution",
    number: "04",
    title: "Execution Discipline",
    subtitle: "Quarterly Focus & Priorities",
    timeframe: "90 Days",
    cellIds: ["quarterly_theme", "quarterly_rocks", "number1_priority"],
  },
  {
    id: "people",
    number: "05",
    title: "People & Capacity",
    subtitle: "Ownership, Threats & Availability",
    timeframe: "Ongoing",
    cellIds: ["accountability_face", "swt_threats", "capacity"],
  },
] as const;


function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : [];
}

function display(labels: Record<string, string>, id: string): string {
  return labels[id] ?? id;
}

/** The provenance line for a cell, e.g. "from Q3, Q4". */
export function formatOpspProvenance(sources: readonly string[]): string {
  const joined = sources.map((q) => q.toUpperCase()).join(", ");
  return `from ${joined}`;
}

/** The short "Q<number>" label for a question id (e.g. "q7" → "Q7"). */
function shortQuestionLabel(id: string): string {
  return id.length > 0 && id[0] === "q" ? `Q${id.slice(1)}` : id.toUpperCase();
}

/**
 * The provenance line for an accepted official cell (F15-T06, ui_ux.md §4.20,
 * e.g. "from Ern (Q7), Paul (Q7)"). Unlike the individual plan's question-only
 * provenance, the official canvas names the respondent whose answer fed each
 * cell and the question it came from. Pure: no I/O.
 */
export function formatOfficialCellProvenance(
  provenance: readonly OfficialCellProvenance[],
): string {
  const joined = provenance
    .map((entry) => `${entry.respondentName} (${shortQuestionLabel(entry.questionId)})`)
    .join(", ");
  return `from ${joined}`;
}

/**
 * Format one fragment of a cell value into readable text. Each fragment is
 * keyed by its source question id and holds the part of that question's stored
 * shape the mapping derived for this cell (lib/opsp.ts). Reuses the same label
 * tables as the review summary so Q5 roles, Q6 choices, Q8 apps and Q14
 * functions read identically on both screens. `nameOf` resolves q14(b)'s
 * teammate ids, exactly as the review takes it.
 */
function formatSourceFragment(id: string, fragment: unknown, nameOf?: DisplayNameResolver): string {
  const v = asRecord(fragment);
  switch (id) {
    case "q1":
    case "q4":
    case "q7":
    case "q12":
    case "q15":
      return String(v.text ?? "");
    case "q2":
      return `The people who would miss it most are ${String(v.who ?? "")}, because ${String(v.because ?? "")}.`;
    case "q3": {
      const number = v.value;
      return `${String(v.metric ?? "")}: ${typeof number === "number" ? number : ""} ${String(v.unit ?? "")}`;
    }
    case "q5":
      return Q5_COLUMNS.map((col) => {
        const ids = strings(v[col]);
        const listed = ids.length
          ? ids.map((rol) => (Q5_ROLE_LABELS as Record<string, string>)[rol] ?? rol).join(", ")
          : "None";
        return `${Q5_COLUMN_LABELS[col]}: ${listed}`;
      }).join("\n");
    case "q6":
      return `${display(Q6_CHOICE_LABELS, String(v.choice ?? ""))} — ${String(v.why ?? "")}`;
    case "q8":
      return strings(v.rank)
        .map((app, i) => `${i + 1}. ${display(APP_LABELS, app)}`)
        .join("\n");
    case "q9":
      return strings(v.items)
        .map((item, i) => `${i + 1}. ${item}`)
        .join("\n");
    case "q10": {
      const amount = v.amount;
      const payerDisplay = Array.isArray(v.payer)
        ? v.payer.join(", ")
        : String(v.payer ?? "");
      return [
        `Payer: ${payerDisplay}`,
        `Model: ${String(v.model ?? "")}`,
        `Pays: ${typeof amount === "number" ? amount : ""} ${String(v.unit ?? "")}`,
        `First real peso: ${String(v.first_peso ?? "")}`,
      ]
        .filter((line) => line.split(": ")[1] !== "")
        .join("\n");
    }
    case "q11":
      // Two shapes share this source: Quarterly Rocks (value holds a `rocks`
      // array) and The #1 Priority (the mapping derives a single star-marked
      // rock). Format both so the cell never renders blank.
      if (Array.isArray(v.rocks)) {
        return (v.rocks as Record<string, unknown>[])
          .map((rock, i) => `${i + 1}. ${String(rock.what ?? "")} — done when: ${String(rock.done_when ?? "")}`)
          .join("\n");
      }
      return `${String(v.what ?? "")}${String(v.done_when ?? "") !== "" ? ` — done when: ${String(v.done_when)}` : ""}`;
    case "q13":
      return [String(v.text ?? ""), `Most likely cause: ${String(v.cause ?? "")}`]
        .filter((line) => line !== "Most likely cause: " && line !== "")
        .join("\n");
    case "q14": {
      // Q14 feeds two cells with different fragments: Accountability / FACe
      // (wants + others) and Capacity (hours). Format whichever are present.
      const lines: string[] = [];
      const wants = strings(v.wants).map((fn) => display(FUNCTION_LABELS, fn));
      if (wants.length > 0) lines.push(`Wants to own: ${wants.join(", ")}`);
      const others = asStringMap(v.others);
      const othersKeys = Object.keys(others);
      if (othersKeys.length > 0) {
        lines.push("Thinks others own:");
        for (const rid of othersKeys) {
          const fn = others[rid];
          if (fn === undefined) continue;
          lines.push(`  ${nameOf ? (nameOf(rid) ?? rid) : rid}: ${display(FUNCTION_LABELS, fn)}`);
        }
      }
      const hours = v.hours;
      if (typeof hours === "number") lines.push(`Hours a week: ${hours}`);
      return lines.join("\n");
    }
    default:
      return "";
  }
}

function asStringMap(value: unknown): Record<string, string> {
  const rec = asRecord(value);
  const result: Record<string, string> = {};
  for (const key of Object.keys(rec)) {
    if (typeof rec[key] === "string") result[key] = rec[key] as string;
  }
  return result;
}

/**
 * Render a non-empty cell's value to readable text. The value is a map keyed
 * by source question id (the shape lib/opsp.ts derives), so each present
 * source contributes its formatted fragment, one per line. An empty cell is
 * never reformatted — the caller only renders non-empty cells here, and the
 * empty-cell treatment is F07-T03.
 */
export function formatOpspCellValue(
  value: unknown,
  nameOf?: DisplayNameResolver,
): string {
  // An edited cell (F07-T05) holds plain text — the respondent's own rewrite —
  // rather than the structured fragment map the mapping derives. Return it
  // verbatim; nothing is re-derived or invented.
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  const lines: string[] = [];
  for (const [id, fragment] of Object.entries(rec)) {
    const formatted = formatSourceFragment(id, fragment, nameOf).trim();
    if (formatted !== "") lines.push(formatted);
  }
  return lines.join("\n");
}

/** Whether a cell carries content worth rendering (F07-T02's provenance rule). */
export function isOpspCellEmpty(cell: Pick<OpspCell, "value">): boolean {
  return cell.value === null || cell.value === undefined;
}