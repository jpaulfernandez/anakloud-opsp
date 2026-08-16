# F08 — Tickets

---

## F08-T01 — Print stylesheet

**Phase:** P1 · **Depends:** F07-T03 · **Traces:** FR-27, `ui_ux.md` §4.16, `tech_infrastructure.md` §7

### Requirements

- The system SHALL provide a real `@media print` stylesheet, not a screen layout scaled down.
- The system SHALL place page breaks between OPSP sections.
- The system SHALL express the ink/pencil distinction through font weight and border style so it survives greyscale printing.
- The system SHALL fit the OPSP to one page where content allows and to two pages otherwise.
- The system SHALL suppress navigation, editing controls and the "How to read this" panel in print.

### Acceptance

- [ ] Printed at greyscale, ink and pencil are distinguishable without colour
- [ ] No section is split awkwardly across a page break
- [ ] No interactive chrome appears in the printed output

---

## F08-T02 — Print route and client save-as-PDF

**Phase:** P1 · **Depends:** F08-T01 · **Traces:** FR-27, `tech_infrastructure.md` §7

### Requirements

- The system SHALL provide an authenticated print route rendering the OPSP with the print stylesheet applied.
- The system SHALL include the respondent's display name, a timestamp, the ink/pencil markings, and the "Your draft — not the company's plan" label.
- The system SHALL make save-as-PDF reachable from the OPSP view on mobile and desktop.
- The system SHALL NOT require a server round trip for the primary export path.

### Acceptance

- [ ] Save-as-PDF from a mobile browser produces a readable document
- [ ] Name, timestamp and draft label present on the output
- [ ] Route requires a valid session

---

## F08-T03 — Server-side PDF rendering

**Phase:** P1 · **Depends:** F08-T02 · **Traces:** `tech_infrastructure.md` §4, §7

### Requirements

- The system SHALL expose `GET /api/opsp/:id/pdf` rendering the authenticated print route to PDF via headless Chromium.
- The system SHALL reuse the Playwright-provided Chromium and SHALL NOT bundle an additional browser.
- The system SHALL NOT use a JavaScript PDF-construction library.
- IF Chromium is unavailable, THEN the system SHALL return a clear failure for this route only, and the client-side print path SHALL remain usable.

### Acceptance

- [ ] Server PDF and browser print produce visually equivalent documents
- [ ] Dependency tree contains no PDF-building library
- [ ] Chromium failure does not affect the OPSP view

---

## F08-T04 — Private exclusion in export paths

**Phase:** P1 · **Depends:** F08-T02, F01-T03 · **Traces:** FR-12, FR-27, `spec.md` §8, `tech_infrastructure.md` §7, §9

### Requirements

- Every PDF path SHALL query answers with `is_private = false`.
- The system SHALL enforce the exclusion in the query and SHALL NOT rely on the template omitting the field.
- The system SHALL exclude Q14(d) from PDFs unconditionally, including from the facilitator's own PDF exports.

### Acceptance

- [ ] A respondent with a populated Q14(d) produces a PDF containing none of that text
- [ ] The facilitator exporting another respondent's PDF also gets no private content
- [ ] A test asserts the PDF data path calls the private-filtering query helper
