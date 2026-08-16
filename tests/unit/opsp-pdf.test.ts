import { describe, expect, it, vi } from "vitest";

// F08-T03 — the Chromium-unavailable edge (tech_infrastructure.md §7, and the
// ticket's "IF Chromium is unavailable, THEN return a clear failure for this
// route only"). The compat test in this file is the only part of the server
// PDF path that can run headlessly: the degradation branch must fail with a
// typed, catchable error rather than leaking a raw browser exception, so the
// route can answer 503 for this one route while the OPSP view (and the
// client-side window.print path, which needs no server at all) stays up.
//
// The happy path — launching real Chromium, loading /opsp/print and producing
// a PDF — needs the live app and is exercised by the DB-backed e2e spec
// (tests/e2e/opsp-pdf.spec.ts); this file pins the failure contract only.
vi.mock("@playwright/test", () => ({
  chromium: {
    launch: vi.fn(() => Promise.reject(new Error("browser binary not found"))),
  },
}));

import { OpspPdfUnavailableError, renderOpspPdf } from "../../lib/opsp-pdf";

describe("renderOpspPdf — Chromium unavailable", () => {
  it("rejects with OpspPdfUnavailableError when the browser cannot be launched", async () => {
    await expect(
      renderOpspPdf({ origin: "http://127.0.0.1:3000", sessionToken: "abc" }),
    ).rejects.toBeInstanceOf(OpspPdfUnavailableError);
  });

  it("names the failure so the route can answer with a clear, route-only error", async () => {
    await expect(
      renderOpspPdf({ origin: "http://127.0.0.1:3000", sessionToken: "abc" }),
    ).rejects.toMatchObject({ name: "OpspPdfUnavailableError" });
  });
});