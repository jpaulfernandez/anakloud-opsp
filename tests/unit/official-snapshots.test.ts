import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SNAPSHOT_MAX_LABEL,
  parseOfficialSnapshotLabel,
} from "../../lib/official-opsp";
import { OFFICIAL_PRINT_LABEL } from "../../lib/print";

// F15-T07 — the pure decisions of the official OPSP versioning and export
// (FR-42). The snapshot label validator is the whole input contract of a named
// snapshot, and the official print label is the exact wording the export header
// carries (the shared F08 print pipeline's header string, but for the
// company's plan rather than a respondent's draft). The DB-enforced snapshot
// immutability is exercised against Postgres in
// official-snapshots.integration.test.ts; these keep the pure shape honest.

describe("parseOfficialSnapshotLabel (F15-T07)", () => {
  it("accepts a non-empty label and trims surrounding whitespace", () => {
    expect(parseOfficialSnapshotLabel("Q4 2026 v1")).toBe("Q4 2026 v1");
    expect(parseOfficialSnapshotLabel("  Q4 2026 v1  ")).toBe("Q4 2026 v1");
  });

  it("rejects missing, non-string, empty or whitespace-only values", () => {
    expect(parseOfficialSnapshotLabel(undefined)).toBeNull();
    expect(parseOfficialSnapshotLabel(null)).toBeNull();
    expect(parseOfficialSnapshotLabel(42)).toBeNull();
    expect(parseOfficialSnapshotLabel("")).toBeNull();
    expect(parseOfficialSnapshotLabel("   ")).toBeNull();
  });

  it("rejects a label longer than the cap, at exactly the cap", () => {
    expect(parseOfficialSnapshotLabel("x".repeat(OFFICIAL_SNAPSHOT_MAX_LABEL))).toBe(
      "x".repeat(OFFICIAL_SNAPSHOT_MAX_LABEL),
    );
    expect(
      parseOfficialSnapshotLabel("x".repeat(OFFICIAL_SNAPSHOT_MAX_LABEL + 1)),
    ).toBeNull();
  });
});

describe("OFFICIAL_PRINT_LABEL (F15-T07)", () => {
  it("carries the official plan identity, distinct from the individual draft label", () => {
    expect(OFFICIAL_PRINT_LABEL).toBe("Official One-Page Strategic Plan");
  });
});