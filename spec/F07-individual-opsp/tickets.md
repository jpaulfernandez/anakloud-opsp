# F07 — Tickets

---

## F07-T01 — Deterministic OPSP mapping

**Phase:** P1 · **Depends:** F01-T07 · **Traces:** FR-22, PR3, `spec.md` §10 criterion 6, `anakloud-baseline-questions.md` Part B

### Requirements

- The system SHALL generate the individual OPSP by a pure mapping function from a respondent's answers to OPSP cells.
- The system SHALL NOT call any AI provider during OPSP generation.
- The system SHALL derive each cell only from the answers of the respondent who owns it.
- The system SHALL implement exactly the sixteen cells and sources from Part B:

| Cell | Fed by | Default mark |
|---|---|---|
| Core Values | Q15 | ink |
| Purpose | Q1, Q2 | ink |
| BHAG | Q4 | **pencil** |
| 3-Year Targets | Q3 | **split** — ink on the metric, pencil on the number |
| Sandbox — core customer | Q5, Q6 | ink |
| Sandbox — boundaries | Q9 | ink |
| Brand Promise | Q7 | **pencil** |
| Profit per X | Q10 | **pencil** |
| 1-Year Critical Number | Q10(d), Q3 | **pencil** |
| Key Initiatives (1 yr) | Q8 | ink |
| Quarterly Theme | Q12 | ink |
| Quarterly Rocks | Q11 | ink |
| The #1 Priority | Q11 star | ink |
| Accountability / FACe | Q14(a), Q14(b) | ink |
| SWT — Threats | Q13 | ink |
| Capacity | Q14(c) | ink |

- The system SHALL support a **per-part mark** on 3-Year Targets, so the metric renders as ink while the number renders as pencil within one cell.
- IF a source answer is absent, THEN the system SHALL leave the cell empty and SHALL NOT substitute, infer, or synthesise content.
- The system SHALL apply pencil where the Part B default is pencil, **and additionally** wherever the respondent recorded low confidence, regardless of the default.
- The system SHALL record, per cell, which question identifiers fed it.
- The system SHALL NOT generate cells Part B marks as deliberately absent: Profit/X targets, per-person KPIs, the full 7 Strata, and cash conversion cycle.
- The system SHALL be deterministic: identical answers produce identical cells.

### Acceptance

- [ ] Generation succeeds with `ANTHROPIC_API_KEY` (historical; renamed to `GEMINI_API_KEY` by F16-T03) absent
- [ ] Golden-file test over the seeded six produces stable output across runs
- [ ] A test asserts all sixteen cells exist and no seventeenth
- [ ] BHAG, Brand Promise, Profit per X and 1-Year Critical Number default to pencil even at high confidence
- [ ] 3-Year Targets renders a mixed mark: ink metric, pencil number
- [ ] A respondent who answered nothing optional gets an OPSP of empty cells, not of plausible text

**Note.** Part B's ink/pencil defaults are editorial judgements about what a pre-beta team can honestly claim, not derivations from the data. They are defaults; FR-26 and F07-T05 let the respondent override any mark after seeing the whole thing.

---

## F07-T02 — OPSP view and draft labelling

**Phase:** P1 · **Depends:** F07-T01 · **Traces:** FR-23, `ui_ux.md` §4.14

### Requirements

- The system SHALL display, above all other content, "Your draft. Not the company's plan." with the supporting line from `ui_ux.md` §4.14.
- The system SHALL NOT allow this label to be dismissed, collapsed, or scrolled past before the cells are reachable.
- WHERE the viewport is wide, the system SHALL render the classic OPSP grid in columns.
- WHEN the viewport is narrow, the system SHALL render vertically stacked cards.
- The system SHALL show a small provenance line per cell naming its source questions.

### Acceptance

- [ ] The draft label is the first thing rendered and is present on every load
- [ ] Grid at desktop, stacked cards at 360px, same content
- [ ] Provenance line renders for every non-empty cell

---

## F07-T03 — Ink, pencil and empty cells

**Phase:** P1 · **Depends:** F07-T02 · **Traces:** FR-24, `ui_ux.md` §2, §4.14, §7

### Requirements

- The system SHALL render cells derived from confident, complete answers as **ink**: solid text at full contrast.
- WHERE a source answer was blank or carried low confidence, the system SHALL render the cell as **pencil**: lighter weight, dashed left border, and a "revisit" tag.
- The system SHALL distinguish ink from pencil by weight, border style and a text tag, and SHALL NOT rely on colour.
- WHEN a cell is pencil due to low confidence, the system SHALL show "You marked low confidence here — worth revisiting after beta."
- WHEN a cell is empty, the system SHALL show "You didn't answer this — that's fine, leave it blank."
- The system SHALL NOT auto-fill any cell.

### Acceptance

- [ ] Rendering in greyscale preserves the ink/pencil distinction
- [ ] Low-confidence and empty cells carry their respective notes
- [ ] No cell contains text not traceable to an answer

---

## F07-T04 — "How to read this" panel

**Phase:** P1 · **Depends:** F07-T02 · **Traces:** FR-25, `ui_ux.md` §4.14

### Requirements

- The system SHALL provide a static explanation per cell covering what the cell is for, what a strong one looks like, and what a weak one looks like, at roughly 40 words each.
- The system SHALL render the panel persistently on the right at desktop and as a bottom sheet on mobile.
- WHEN a cell is activated, the system SHALL scroll the panel to that cell's explanation.
- The panel content SHALL be static and SHALL NOT be generated at runtime.

### Acceptance

- [ ] Every cell has an explanation; a test asserts no cell key is missing one
- [ ] Tapping a cell moves the panel to the matching entry on both layouts
- [ ] Panel content is authored in the repository, not fetched

---

## F07-T05 — OPSP editing and versioning

**Phase:** P1 · **Depends:** F07-T02, F06-T04 · **Traces:** FR-26, PR5, `ui_ux.md` §4.15

### Requirements

- The system SHALL permit the respondent to edit their own OPSP cells inline.
- WHEN a cell is edited, the system SHALL create a new `opsp_drafts` version and SHALL NOT modify the previous one.
- Editing an OPSP cell SHALL NOT modify any `answers` row.
- The system SHALL display a persistent note in the edit bar: "Editing this doesn't change your survey answers — those stay as you submitted them."
- The system SHALL permit manual toggling of the ink/pencil mark per cell.

### Acceptance

- [ ] Editing three cells produces new versions with prior versions intact
- [ ] A test asserts the OPSP edit route cannot write to `answers`
- [ ] The persistent note is visible throughout editing, not shown once
