import { chromium } from "@playwright/test";
import type { ClientBase } from "pg";
import { SESSION_COOKIE } from "./session";
import { listPublicAnswers } from "./answers";
import { buildOpspCells, type OpspCell, type OpspCellId } from "./opsp";

// F08-T04 — the PDF data path (FR-12, FR-27, spec.md §8,
// tech_infrastructure.md §7, §9). The one loader every print/PDF request — a
// respondent's own /opsp/print, the server PDF that renders it, and a
// facilitator exporting another respondent's plan — runs the sheet through.
// It reads the respondent's answers through listPublicAnswers, the
// private-filtering query helper, and builds the sixteen cells from those
// public answers alone. Enforcing exclusion in the query is what keeps Q14(d)
// off every PDF unconditionally: no template or view ever has to remember to
// omit the private note, because the note is not in the data it receives. The
// loader must run inside the caller's RLS context, which is exactly what
// allows the facilitator role (who can read cohort-wide answers) to load
// another respondent's plan while listPublicAnswers still filters private rows
// in the SQL.

/**
 * Build the printable OPSP sheet for a respondent from their public answers.
 * `respondentId` may be the caller's own id or a cohort mate's when the caller
 * acts as the facilitator; in either case listPublicAnswers filters
 * `is_private = false`, so Q14(d) is structurally absent. Call inside
 * withRespondentContext.
 */
export async function loadOpspPrintSheet(
  db: ClientBase,
  respondentId: string,
): Promise<Record<OpspCellId, OpspCell>> {
  const answers = await listPublicAnswers(db, respondentId);
  const snapshot: Record<string, { value: unknown; confidence: number | null }> = {};
  for (const a of answers) {
    snapshot[a.question_id] = { value: a.value, confidence: a.confidence };
  }
  return buildOpspCells(snapshot);
}

// F08-T03 — server-side PDF rendering (GET /api/opsp/:id/pdf,
// tech_infrastructure.md §4, §7).
//
// The secondary export path behind the print stylesheet + window.print()
// primary (F08-T01/T02): headless Chromium renders the authenticated print
// route to a PDF. The browser this module drives is the very one Playwright
// already bundles for the E2E suite — the spec is explicit that this project
// SHALL NOT bundle a second browser, and Playwright is already a dependency
// here. The sheet that lands on the PDF is /opsp/print, the identical read-only
// OPSPView the interactive view renders in printMode, so the server PDF and a
// respondent's own browser print are equivalent by construction rather than by
// a second layout that could drift. Nothing here constructs the layout by
// hand, and there is no JavaScript PDF-building library in the tree (the
// dependency test pins that).
//
// The one thing this module cannot guarantee is that Chromium exists on the
// host serving the route. On a host without the browser the launch throws, and
// that is surfaced as OpspPdfUnavailableError so the route can answer with a
// clear failure for this one route while the client-side print path (which
// needs no server at all) stays untouched.

/** Thrown when headless Chromium cannot be launched to render the sheet. */
export class OpspPdfUnavailableError extends Error {
  constructor() {
    super("headless Chromium is unavailable on this server");
    this.name = "OpspPdfUnavailableError";
  }
}

export interface OpspPdfRender {
  /** Scheme://host:port of the running app, e.g. http://127.0.0.1:3000. */
  origin: string;
  /** The signed session cookie value that the print route authenticates. */
  sessionToken: string;
}

/**
 * Render the authenticated print route to a PDF buffer via headless Chromium.
 * Launches a browser, seeds the respondent's session cookie, loads /opsp/print
 * (a server-rendered grid, so the sheet is in the initial HTML) and returns
 * Chromium's PDF bytes. A browser that cannot be obtained rejects with
 * OpspPdfUnavailableError; a rendering problem once the browser is up throws
 * normally so genuine application failures stay loud in development.
 */
export async function renderOpspPdf(input: OpspPdfRender): Promise<Buffer> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new OpspPdfUnavailableError();
  }
  try {
    const context = await browser.newContext();
    try {
      await context.addCookies([
        {
          name: SESSION_COOKIE,
          value: input.sessionToken,
          httpOnly: true,
          sameSite: "Lax",
          url: `${input.origin}/`,
        },
      ]);
      const page = await context.newPage();
      await page.goto(`${input.origin}/opsp/print`, { waitUntil: "load" });
      // The grid is server-rendered, so waiting for it is also the guard that
      // the route did not bounce an unauthenticated visitor back to claim.
      await page.locator('[data-testid="opsp-grid"]').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      return await page.pdf({ format: "A4", printBackground: true });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}