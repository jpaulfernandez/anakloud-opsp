import { describe, expect, it } from "vitest";
import { PRINT_DRAFT_LABEL, formatExportTimestamp } from "../../lib/print";

// F08-T02 — the printed OPSP sheet's header (FR-27, tech_infrastructure §7,
// ui_ux §4.16). Pure strings, no browser: the draft label is the exact FR-23 /
// §4.16 wording (an em dash, not the on-screen full stop), and the timestamp is
// a deterministic, zero-padded local-time string so the interactive OPSP view
// and the print route can render the same text by construction.

describe("PRINT_DRAFT_LABEL", () => {
  it("is the exact FR-23 / §4.16 wording", () => {
    expect(PRINT_DRAFT_LABEL).toBe("Your draft — not the company's plan");
  });
});

describe("formatExportTimestamp", () => {
  it("zero-pads day, hour and minute", () => {
    const stamp = formatExportTimestamp(new Date(2026, 7, 17, 9, 5));
    expect(stamp).toBe("Generated 17 Aug 2026, 09:05");
  });

  it("does not pad a two-digit day, hour or minute", () => {
    const stamp = formatExportTimestamp(new Date(2026, 11, 25, 14, 30));
    expect(stamp).toBe("Generated 25 Dec 2026, 14:30");
  });
});