# F08 — Print & PDF export

**Phase:** P1 · **Depends on:** F07 · **Blocks:** —

## What this is

Getting the OPSP off the screen and onto paper or into a file, with the private field unconditionally absent.

`tech_infrastructure.md` §7 is unusually prescriptive here and worth following exactly:

- **Primary path is print CSS + `window.print()`.** Zero dependencies, zero server cost, works from any device.
- **Secondary path is headless Chromium via Playwright**, rendering an authenticated print route. Playwright is already a dependency because of the E2E suite, so this costs nothing extra. Do not bundle a second browser.
- **Do not use a JS PDF-building library.** The OPSP is a grid with mixed typographic weights; hand-building it in a PDF DSL costs more than it saves and drifts from what's on screen.

## Scope

- `@media print` stylesheet with real page breaks
- Print route and client-side save-as-PDF
- Server-side Chromium rendering
- Query-layer private exclusion on every PDF path

## Exit criteria

- Saving to PDF from a phone browser produces a readable one- or two-page document
- Ink/pencil is distinguishable in greyscale
- Q14(d) is absent from every generated PDF, enforced in the query

## Risks

- Print stylesheets rot silently — nobody looks at them. F11 should include a rendered-PDF check in E2E so a regression surfaces.
