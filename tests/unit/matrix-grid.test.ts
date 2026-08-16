import { describe, expect, it } from "vitest";
import {
  matrixGridIsAnswered,
  Q5_COLUMNS,
  Q5_COLUMN_LABELS,
  Q5_ROLE_LABELS,
  toggleRole,
} from "../../lib/matrix-grid";
import { Q5_ROLE_IDS, type Q5Value, type RoleId } from "../../lib/questions";

// Pure matrix-grid helpers (F03-T05, ui_ux.md §4.8, anakloud-baseline-questions.md
// Q5). The per-cell toggle and the "answered" rule are deterministic behaviour
// the shell's forward-navigation depends on, so they are verified without a
// browser. The key property here is that the grid checkbox and the pivot
// multi-select both write through `toggleRole`, so "both presentations write
// identical payloads for identical selections" is guaranteed by construction
// and asserted directly below.

const empty: Q5Value = { pays: [], decides: [], uses: [], benefits: [] };

describe("the matrix vocabulary", () => {
  it("has exactly the four specified columns", () => {
    expect(Q5_COLUMNS).toEqual(["pays", "decides", "uses", "benefits"]);
  });

  it("labels the four columns verbatim from the ticket", () => {
    expect(Q5_COLUMN_LABELS).toEqual({
      pays: "Pays us",
      decides: "Decides to adopt",
      uses: "Uses it most days",
      benefits: "Benefits most",
    });
  });

  it("labels all nine roles, covering every registry role id", () => {
    expect(Q5_ROLE_IDS).toHaveLength(9);
    for (const role of Q5_ROLE_IDS) {
      expect(Q5_ROLE_LABELS[role]).toBeTruthy();
    }
    // Spot-check the longer, verbatim row labels.
    expect(Q5_ROLE_LABELS.pediatrician).toBe("Pediatrician / developmental pedia");
    expect(Q5_ROLE_LABELS.center_owner).toBe("Therapy center owner or director");
    expect(Q5_ROLE_LABELS.lgu_doh).toBe("LGU or DOH program");
  });
});

describe("toggleRole", () => {
  it("marks a role in a column", () => {
    const next = toggleRole(empty, "pays", "parent");
    expect(next.pays).toEqual(["parent"]);
    expect(next.decides).toEqual([]);
  });

  it("unmarks a role that is already present", () => {
    const { pays } = toggleRole(toggleRole(empty, "pays", "parent"), "pays", "parent");
    expect(pays).toEqual([]);
  });

  it("allows a role in more than one column (a role may do several things)", () => {
    const once = toggleRole(empty, "pays", "center_owner");
    const twice = toggleRole(once, "decides", "center_owner");
    expect(twice.pays).toEqual(["center_owner"]);
    expect(twice.decides).toEqual(["center_owner"]);
  });

  it("keeps each column in registry order regardless of tap order", () => {
    // The stored arrays are sorted by registry order, so the same selected set
    // always yields the same payload no matter which order the boxes were
    // tapped — the grid and the pivot cannot drift apart.
    const reversed = ["hmo_insurer", "child", "parent", "center_owner"].reduce(
      (acc, role) => toggleRole(acc, "pays", role as RoleId),
      empty,
    );
    const forwards = ["center_owner", "parent", "child", "hmo_insurer"].reduce(
      (acc, role) => toggleRole(acc, "pays", role as RoleId),
      empty,
    );
    expect(reversed.pays).toEqual(["center_owner", "parent", "child", "hmo_insurer"]);
    expect(forwards.pays).toEqual(reversed.pays);
  });
});

describe("matrixGridIsAnswered", () => {
  it("is unanswered while the whole matrix is empty", () => {
    expect(matrixGridIsAnswered(empty)).toBe(false);
  });

  it("is answered as soon as any role is marked in any column", () => {
    expect(matrixGridIsAnswered(toggleRole(empty, "pays", "parent"))).toBe(true);
    expect(matrixGridIsAnswered(toggleRole(empty, "benefits", "child"))).toBe(true);
  });

  it("is answered even if only one column holds a mark", () => {
    // A role may be marked in none of the columns — that is the point of the
    // "or none" freedom — so one mark anywhere is a complete-enough answer.
    const withOneColumn = { ...empty, uses: ["parent" as RoleId] };
    expect(matrixGridIsAnswered(withOneColumn)).toBe(true);
  });
});