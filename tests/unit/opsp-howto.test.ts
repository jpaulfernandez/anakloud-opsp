import { describe, expect, it } from "vitest";
import { OPSP_CELL_IDS } from "../../lib/opsp";
import { OPSP_HOWTO, type OpspHowtoEntry } from "../../lib/opsp-howto";

// F07-T04 — the "How to read this" panel's content (FR-25, ui_ux.md §4.14).
// Pure assertions over the repository-authored guide, no browser: every Part B
// cell (lib/opsp.ts) must have an explanation, and each explanation must cover
// the three things §4.14 asks for — what the cell is for, what a strong one
// looks like, what a weak one looks like — at roughly forty words. Because the
// content lives in a static module with no I/O, "panel content is authored in
// the repository, not fetched" is guaranteed by construction and these tests
// pin the contract that would otherwise be easy to slip: a cell added to the
// mapping (F07-T01) without a matching guide entry, or an entry that reads
// like filler.

function words(s: string): number {
  return s.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

function totalWords(entry: OpspHowtoEntry): number {
  return words(entry.purpose) + words(entry.strong) + words(entry.weak);
}

describe("F07-T04 how-to panel content", () => {
  it("has exactly one explanation per Part B cell and no extra keys", () => {
    expect(Object.keys(OPSP_HOWTO).sort()).toEqual([...OPSP_CELL_IDS].sort());
    expect(Object.keys(OPSP_HOWTO)).toHaveLength(OPSP_CELL_IDS.length);
    // _every_ cell has an explanation — the acceptance criterion restated:
    // no cell key is missing one.
    for (const id of OPSP_CELL_IDS) {
      expect(OPSP_HOWTO[id], `no explanation for ${id}`).toBeDefined();
    }
  });

  it("covers what the cell is for, a strong one, and a weak one for every cell", () => {
    for (const id of OPSP_CELL_IDS) {
      const entry = OPSP_HOWTO[id];
      const fields = [entry.purpose, entry.strong, entry.weak];
      for (const field of fields) {
        expect(field, `${id} field must not be empty`).toBeTruthy();
      }
      // Each of the three aspects is a real sentence, not a stub.
      for (const field of fields) {
        expect(words(field), `${id} aspect too short: "${field}"`).toBeGreaterThan(3);
      }
    }
  });

  it("keeps each explanation near the roughly-forty-words target", () => {
    for (const id of OPSP_CELL_IDS) {
      const n = totalWords(OPSP_HOWTO[id]);
      // "roughly 40" — a wide band that still rejects padding or a one-liner.
      expect(n, `${id} explanation is ${n} words`).toBeGreaterThanOrEqual(20);
      expect(n, `${id} explanation is ${n} words`).toBeLessThanOrEqual(65);
    }
  });

  it("is static text authored up front, not derived from runtime data", () => {
    // The guide is a plain literal map keyed by cell id — no function, no
    // question value, no respondent data. Rendering it needs no inputs, so it
    // can never reflect (or leak) a live answer. Assert it is free of the
    // characters only a generated fragment would produce.
    for (const id of OPSP_CELL_IDS) {
      const joined = [
        OPSP_HOWTO[id].purpose,
        OPSP_HOWTO[id].strong,
        OPSP_HOWTO[id].weak,
      ].join(" ");
      expect(joined).not.toContain("undefined");
      expect(joined).not.toContain("[object");
      // It names neither specific people nor cohort data.
      expect(joined).not.toContain("@");
      expect(joined).not.toContain("Q1");
    }
  });
});