import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// F08-T04 acceptance: a test asserts the PDF data path calls the
// private-filtering query helper. The static break below pins that the sheet a
// PDF renders is not assembled from a stored note or read straight off the
// answers table — it is built by loadOpspPrintSheet (lib/opsp-pdf.ts) from
// listPublicAnswers, the single helper whose SQL filters is_private = false.
// This is the same source-level guarantee style as private-rows.test.ts, which
// already keeps every direct select from `answers` inside lib/answers.ts.

const ROOT = resolve(process.cwd());

describe("F08-T04 — private exclusion in export paths (FR-12, FR-27)", () => {
  it("the PDF data loader reads answers through the private-filtering query helper", () => {
    const dataPath = readFileSync(resolve(ROOT, "lib/opsp-pdf.ts"), "utf8");
    // The print/PDF sheet is built from the private-filtering helper...
    expect(dataPath).toMatch(/listPublicAnswers/);
    // ...and never selects from the answers table itself (the F01-T03
    // invariant keeps every such select inside lib/answers.ts).
    expect(dataPath).not.toMatch(/from\s+answers\b/i);
  });

  it("the print route sources its sheet from the private-filtering PDF data path", () => {
    const route = readFileSync(resolve(ROOT, "app/opsp/print/page.tsx"), "utf8");
    // The route renders the sheet loadOpspPrintSheet produces...
    expect(route).toMatch(/loadOpspPrintSheet/);
    // ...rather than the stored draft or a direct answers query. Enforcing the
    // exclusion in loadOpspPrintSheet's query is what keeps Q14(d) off the
    // sheet even if someone later edits the template.
    expect(route).not.toMatch(/latestIndividualDraft/);
    expect(route).not.toMatch(/from\s+answers\b/i);
  });
});