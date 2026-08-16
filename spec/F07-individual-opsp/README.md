# F07 — Individual OPSP

**Phase:** P1 · **Depends on:** F06 · **Blocks:** F08, F15

## What this is

The thing the respondent gets back for twenty-five minutes of honest thinking: their own One-Page Strategic Plan, derived from their own answers, by a pure function.

Three constraints define it:

- **No AI, at all.** FR-22 is explicit: generation is a deterministic mapping. This is what makes acceptance criterion 6 (everything works with the key removed) achievable.
- **Nothing is invented.** Blank stays blank. Low confidence renders as pencil with a "revisit after beta" tag. The temptation to fill a hole with something plausible is the temptation to fabricate the respondent's strategy for them.
- **"Your draft — not the company's plan"** is unavoidable, at the top, every time (FR-23).

## Scope

- Pure mapping function, answers → OPSP cells
- OPSP grid view, desktop and mobile
- Ink/pencil marks and empty-cell treatment
- "How to read this" static panel
- Cell editing with versioning, which never touches the answers

## Exit criteria

- Two respondents with different answers get visibly different OPSPs
- A respondent who skipped optional questions sees blanks, not filler
- Editing a cell creates a new draft version and leaves `answers` unchanged
- Every cell shows its provenance ("from Q3, Q4")

## The mapping

`anakloud-baseline-questions.md` Part B is the specification for F07-T01: sixteen cells, their source questions, and a default ink/pencil mark per cell. Two details in it are easy to miss:

- **Four cells default to pencil regardless of confidence** — BHAG, Brand Promise, Profit per X, and the 1-Year Critical Number. These are pre-beta guesses by nature, and the doc says so.
- **3-Year Targets carries a split mark** — ink on the metric, pencil on the number. The cell renderer needs per-part marks, not one mark per cell. Build that in from the start rather than special-casing it later.

Part B also names what is deliberately *not* generated: Profit/X targets, per-person KPIs, the full 7 Strata, cash conversion cycle. Those need a real customer base to be anything other than fiction.

## Risks

- Ink vs pencil must survive printing to black and white (`ui_ux.md` §2). Use weight and border style, never colour alone. F08 depends on this being right here rather than patched in the print stylesheet.
