import { describe, expect, it } from "vitest";
import { resolveSyncConflict } from "../../lib/sync-conflict";

// Sync conflict resolution (F04-T04, ui_ux.md §6). The rules under test:
//   * server wins on lock status — a locked server always resolves locked;
//   * local wins on content for an unlocked question — local content proceeds
//     to the normal save path, never overwritten by a server fetch;
//   * typed text is never silently discarded — when the server is locked while
//     the local value is unsaved, that value is preserved read-only;
//   * a locked server with nothing unsaved has nothing to surface.
//
// The property test (last block) sweeps interleaved local-edit / server-save /
// server-lock sequences and asserts the no-content-loss invariant at every
// step: any local value that differs from the last confirmed server content is
// either left saveable (server unlocked) or surfaced read-only (server locked).

/** Two JSON-like values are "same" when their serialized forms match — the
    resolver treats values opaquely, so JSON identity is what distinguishes
    "local differs from the last confirmed server content". */
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

describe("resolveSyncConflict", () => {
  it("lets local content win when the server is unlocked", () => {
    const result = resolveSyncConflict(
      { value: { text: "Local typed answer" }, unsaved: true },
      { locked: false },
    );
    expect(result).toEqual({ locked: false });
  });

  it("takes the server's value when it reports locked", () => {
    const result = resolveSyncConflict(
      { value: { text: "Local typed answer" }, unsaved: true },
      { locked: true },
    );
    expect(result.locked).toBe(true);
  });

  it("preserves unsaved local text when the server locks it out", () => {
    const typed = { text: "Don't lose this." };
    const result = resolveSyncConflict(
      { value: typed, unsaved: true },
      { locked: true },
    );
    expect(result).toEqual({ locked: true, preserve: typed });
  });

  it("surfaces nothing when locked but the local value is not unsaved", () => {
    const result = resolveSyncConflict(
      { value: { text: "same as saved" }, unsaved: false },
      { locked: true },
    );
    expect(result).toEqual({ locked: true, preserve: null });
  });

  it("never mangles the preserved value", () => {
    const result = resolveSyncConflict(
      { value: "   ", unsaved: true },
      { locked: true },
    );
    expect(result).toEqual({ locked: true, preserve: "   " });
  });
});

describe("no-content-loss property over interleaved sequences", () => {
  /** Deterministic PRNG so the sweep is reproducible across runs. */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("never drops local content across edits, saves and lock signals", () => {
    const rand = mulberry32(0xc0ffee);

    // Model the two states the resolver reasons about, mirroring the autosave
    // hook: `local` is the latest typed value (each edit assigns a fresh token),
    // `confirmed` is the last value the server confirmed while unlocked, and
    // `unsaved` is derived as "local differs from confirmed".
    let local: unknown = null;
    let confirmed: unknown = null;
    let serverLocked = false;

    const assertNoLoss = () => {
      const unsaved = !same(local, confirmed);
      const resolution = resolveSyncConflict(
        { value: local, unsaved },
        { locked: serverLocked },
      );
      // The lock status always follows the server (server wins on lock).
      expect(resolution.locked).toBe(serverLocked);
      if (unsaved) {
        // No content loss: the distinct local value is either on its way to a
        // save (unlocked) or surfaced read-only (locked) — never absent.
        if (serverLocked) {
          if (resolution.locked === true) {
            expect(resolution.preserve).not.toBeNull();
            expect(same(resolution.preserve, local)).toBe(true);
          }
        }
      }
    };

    // Sweep: for a fixed sequence length, drive a mix of local edits, server
    // saves (only while unlocked) and a single lock signal, asserting the
    // invariant after every operation.
    for (let step = 0; step < 400; step++) {
      const op = Math.floor(rand() * 3);
      if (op === 0) {
        // local edit — a fresh, distinct token.
        local = `answer-${step}`;
      } else if (op === 1) {
        // server confirms a save (only meaningful while unlocked).
        if (!serverLocked) confirmed = local;
      } else {
        // lock signal — sticks once sent; saves stop meaning anything after.
        serverLocked = true;
      }
      assertNoLoss();
    }
  });

  it("preserves the latest typed text even after the lock arrives", () => {
    // Concrete scenario: two tabs share a respondent. The first tab submits
    // (locks), while the second keeps typing into the same question. Each later
    // edit is new unsaved local content that the resolver must keep surfaced.
    let local: unknown = null;
    let confirmed: unknown = null;
    let serverLocked = false;
    let resolution = resolveSyncConflict(
      { value: local, unsaved: !same(local, confirmed) },
      { locked: serverLocked },
    );

    // First tab types an answer, which saves while unlocked.
    local = { text: "v1" };
    confirmed = local;
    resolution = resolveSyncConflict(
      { value: local, unsaved: !same(local, confirmed) },
      { locked: serverLocked },
    );
    expect(resolution).toEqual({ locked: false });

    // First tab submits; server locks.
    serverLocked = true;

    // Second tab keeps typing; each new value is unsaved and must be surfaced.
    for (const version of ["v2", "v3", "v4"]) {
      local = { text: version };
      resolution = resolveSyncConflict(
        { value: local, unsaved: !same(local, confirmed) },
        { locked: serverLocked },
      );
      expect(resolution).toEqual({ locked: true, preserve: local });
    }

    // If the second tab reverts to the confirmed value, nothing distinct is
    // left to surface — but the lock still stands.
    local = confirmed;
    resolution = resolveSyncConflict(
      { value: local, unsaved: !same(local, confirmed) },
      { locked: serverLocked },
    );
    expect(resolution).toEqual({ locked: true, preserve: null });
  });
});