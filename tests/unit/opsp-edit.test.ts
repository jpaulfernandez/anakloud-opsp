import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type OpspCell } from "../../lib/opsp";
import {
  applyCellEdit,
  parseOpspEdit,
} from "../../lib/opsp-edit";
import { currentCellMark } from "../../lib/opsp-state";

// F07-T05 — OPSP editing and versioning (FR-26, PR5, ui_ux.md §4.15). These
// are the pure decisions of the edit path: parsing and validating an edit
// body, applying an edit to a cell (without mutating the original), and the
// starting value of the ink/pencil toggle. The versioned DB write and the
// "route never writes to answers" guarantee are exercised against Postgres in
// opsp-edit.integration.test.ts and pinned at the source level below.

describe("F07-T05 parseOpspEdit", () => {
  it("parses a content edit", () => {
    expect(parseOpspEdit({ cellId: "purpose", content: "Our new purpose" })).toEqual({
      cellId: "purpose",
      content: "Our new purpose",
    });
  });

  it("parses a mark-only edit (nothing else present)", () => {
    expect(parseOpspEdit({ cellId: "bhag", mark: "ink" })).toEqual({
      cellId: "bhag",
      mark: "ink",
    });
  });

  it("parses a combined content and mark edit", () => {
    expect(parseOpspEdit({ cellId: "capacity", content: "", mark: "pencil" })).toEqual({
      cellId: "capacity",
      content: "",
      mark: "pencil",
    });
  });

  it("accepts explicit null content as clearing the cell", () => {
    expect(parseOpspEdit({ cellId: "capacity", content: null })).toEqual({
      cellId: "capacity",
      content: null,
    });
  });

  it("rejects a non-object body", () => {
    expect(parseOpspEdit(null)).toBeNull();
    expect(parseOpspEdit("purpose")).toBeNull();
    expect(parseOpspEdit([])).toBeNull();
  });

  it("rejects an unknown cellId", () => {
    expect(parseOpspEdit({ cellId: "not_a_cell", content: "x" })).toBeNull();
    expect(parseOpspEdit({ content: "x" })).toBeNull();
  });

  it("rejects a wrong-typed mark", () => {
    expect(parseOpspEdit({ cellId: "bhag", mark: "red" })).toBeNull();
    expect(parseOpspEdit({ cellId: "bhag", mark: 1 })).toBeNull();
  });

  it("rejects wrong-typed content", () => {
    expect(parseOpspEdit({ cellId: "purpose", content: 7 })).toBeNull();
    expect(parseOpspEdit({ cellId: "purpose", content: {} })).toBeNull();
  });

  it("rejects an edit that changes nothing", () => {
    expect(parseOpspEdit({ cellId: "purpose" })).toBeNull();
  });
});

describe("F07-T05 applyCellEdit", () => {
  const base: OpspCell = {
    value: { q4: { text: "Clinic in every barangay by five." } },
    marking: { type: "single", mark: "pencil" },
    sources: ["q4"],
    lowConfidence: true,
  };

  it("replaces a cell's content with the respondent's rewrite, keeping sources", () => {
    const next = applyCellEdit(base, { cellId: "bhag", content: "One live record" });
    expect(next.value).toBe("One live record");
    // Provenance and the low-confidence flag survive an edit.
    expect(next.sources).toEqual(["q4"]);
    expect(next.lowConfidence).toBe(true);
  });

  it("clears a cell to empty when content is an empty string", () => {
    const next = applyCellEdit(base, { cellId: "bhag", content: "" });
    expect(next.value).toBeNull();
  });

  it("clears a cell to empty when content is null", () => {
    const next = applyCellEdit(base, { cellId: "bhag", content: null });
    expect(next.value).toBeNull();
  });

  it("toggles the mark to a single whole-cell value", () => {
    const next = applyCellEdit(base, { cellId: "bhag", mark: "ink" });
    expect(next.marking).toEqual({ type: "single", mark: "ink" });
    // A mark-only edit leaves the content alone.
    expect(next.value).toEqual({ q4: { text: "Clinic in every barangay by five." } });
  });

  it("leaves untouched fields unchanged", () => {
    const next = applyCellEdit(base, { cellId: "bhag", content: "x" });
    expect(next.marking).toEqual({ type: "single", mark: "pencil" });
  });

  it("never mutates the original cell", () => {
    applyCellEdit(base, { cellId: "bhag", content: "changed", mark: "ink" });
    expect(base.value).toEqual({ q4: { text: "Clinic in every barangay by five." } });
    expect(base.marking).toEqual({ type: "single", mark: "pencil" });
  });
});

describe("F07-T05 currentCellMark", () => {
  it("returns the whole-cell mark from a single mark", () => {
    expect(currentCellMark({ marking: { type: "single", mark: "ink" } })).toBe("ink");
    expect(currentCellMark({ marking: { type: "single", mark: "pencil" } })).toBe("pencil");
  });

  it("reads a split 3-Year Targets cell as pencil (it always carries a pencil part)", () => {
    const split: OpspCell["marking"] = {
      type: "parts",
      parts: [
        { key: "metric", mark: "ink" },
        { key: "number", mark: "pencil" },
      ],
    };
    expect(currentCellMark({ marking: split })).toBe("pencil");
  });
});

describe("the OPSP edit path structurally cannot write to answers", () => {
  // PR5's whole claim for F07-T05 is that editing the OPSP never touches the
  // answers table. That holds structurally because every write the edit route
  // can reach is a single `insert into opsp_drafts` in lib/opsp-edit.ts, and
  // neither the route nor that lib imports or invokes the answers writer
  // (lib/answers.upsertAnswer). The DB integration test (opsp-edit.integration)
  // proves it behaviourally; these source pins keep the guarantee honest if a
  // future edit silently starts writing answers elsewhere.
  const route = readFileSync(resolve("app/api/opsp/[id]/route.ts"), "utf8");
  const lib = readFileSync(resolve("lib/opsp-edit.ts"), "utf8");

  it("neither the route nor its lib writes to the answers table", () => {
    expect(route).not.toMatch(/upsertAnswer/);
    expect(route).not.toMatch(/insert into answers/);
    expect(lib).not.toMatch(/upsertAnswer/);
    expect(lib).not.toMatch(/insert into answers/);
  });

  it("the only write in the edit path is a new opsp_drafts version", () => {
    // The route delegates writes entirely to the lib, which contains exactly
    // one DML statement: the version insert into opsp_drafts.
    expect(route).not.toMatch(/insert into/);
    expect(lib).toMatch(/insert into opsp_drafts/);
  });
});