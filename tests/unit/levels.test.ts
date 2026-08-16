import { describe, expect, it } from "vitest";
import {
  coachActiveAtLevel,
  type ResolvedLevel,
} from "../../lib/levels";

// F05-T06 — the L3 plain-form rule (spec.md §7 "None. Every answer accepted",
// PR6, ui_ux D3). Only L3 switches the coach off; every other served level —
// modelled, deterministic, or the unselected `auto` — keeps the deterministic
// sibling so a failing validator still produces a nudge.

describe("coachActiveAtLevel", () => {
  it("disables the coach only at L3", () => {
    expect(coachActiveAtLevel("L3")).toBe(false);
  });

  it("keeps the coach active at every modelled level below L3", () => {
    expect(coachActiveAtLevel("L0")).toBe(true);
    expect(coachActiveAtLevel("L1")).toBe(true);
    expect(coachActiveAtLevel("L2")).toBe(true);
  });

  it("keeps the coach active when the level is still unselected (auto)", () => {
    // Until a runtime selector exists (F12), `auto` behaves like the fallback
    // sibling rather than a mode with no coach at all.
    expect(coachActiveAtLevel("auto")).toBe(true);
  });

  it("is stable across every valid resolved level value", () => {
    const levels: ResolvedLevel[] = ["L0", "L1", "L2", "L3", "auto"];
    expect(levels.filter(coachActiveAtLevel)).toEqual([
      "L0",
      "L1",
      "L2",
      "auto",
    ]);
  });
});