import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { OPSP_CELL_IDS } from "../../lib/opsp";
import {
  buildOfficialCellDraft,
  emptyOfficialCells,
  type OfficialSourceCard,
} from "../../lib/official-opsp";

// F15-T01 — the official OPSP canvas (FR-36, ui_ux.md §4.20). These are the
// pure decisions of the official-draft path: the blank opening canvas, and the
// structural guarantee that authoring never reuses the answers writer. The
// DB-enforced one-lineage-per-cohort and the facilitator-only RLS write are
// exercised against Postgres in official-opsp.integration.test.ts; these pins
// keep the pure shape and the "no write to answers" guarantee honest.

describe("F15-T01 emptyOfficialCells", () => {
  it("opens all sixteen cells blank with a pencil mark", () => {
    const cells = emptyOfficialCells();
    expect(Object.keys(cells).sort()).toEqual([...OPSP_CELL_IDS].sort());
    for (const id of OPSP_CELL_IDS) {
      expect(cells[id].value).toBeNull();
      expect(cells[id].marking).toEqual({ type: "single", mark: "pencil" });
      expect(cells[id].sources).toEqual([]);
      expect(cells[id].lowConfidence).toBe(false);
    }
  });
});

describe("the official OPSP authoring path structurally cannot write to answers (PR5)", () => {
  // PR5's whole claim for F15-T01 is that authoring the official plan never
  // touches the answers table. That holds structurally because the only write
  // the official edit route can reach is the `insert into opsp_drafts` in
  // lib/official-opsp.ts, and neither the route nor that lib imports or
  // invokes the answers writer (lib/answers.upsertAnswer). The RLS integration
  // test proves it behaviourally for the write path; these source pins keep the
  // guarantee honest if a future edit silently starts writing answers.
  const route = readFileSync(resolve("app/api/admin/official-opsp/route.ts"), "utf8");
  const lib = readFileSync(resolve("lib/official-opsp.ts"), "utf8");

  it("neither the official route nor its lib writes to the answers table", () => {
    expect(route).not.toMatch(/upsertAnswer/);
    expect(route).not.toMatch(/insert into answers/);
    expect(lib).not.toMatch(/upsertAnswer/);
    expect(lib).not.toMatch(/insert into answers/);
  });

  it("the only write in the official authoring path is a new opsp_drafts version", () => {
    expect(route).not.toMatch(/insert into/);
    expect(lib).toMatch(/insert into opsp_drafts/);
  });
});

describe("F15-T04 draft state", () => {
  it("buildOfficialCellDraft dedupes source question ids in attachment order", () => {
    const cards: OfficialSourceCard[] = [
      { id: "c1", respondentId: "r1", respondentName: "A", questionId: "q7", text: "x" },
      { id: "c2", respondentId: "r2", respondentName: "B", questionId: "q7", text: "y" },
      { id: "c3", respondentId: "r3", respondentName: "C", questionId: "q4", text: "z" },
    ];
    const draft = buildOfficialCellDraft(cards, "One draft.");
    expect(draft.statement).toBe("One draft.");
    expect(draft.sourceQuestionIds).toEqual(["q7", "q4"]);
  });

  it("the synthesis/accept/discard routes never write to the answers table (PR5)", () => {
    for (const file of [
      "app/api/admin/synthesise/route.ts",
      "app/api/admin/synthesise/accept/route.ts",
      "app/api/admin/synthesise/discard/route.ts",
    ]) {
      const src = readFileSync(resolve(file), "utf8");
      expect(src).not.toMatch(/upsertAnswer/);
      expect(src).not.toMatch(/insert into answers/);
    }
  });
});