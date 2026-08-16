# F15 — Official OPSP canvas

**Phase:** P4 · **Depends on:** F12, F07 · **Blocks:** —

## What this is

The collaborative canvas the team fills in during or after the alignment session — and the one feature in this product where a piece of software is doing organisational work rather than clerical work.

That piece is the **conflict guard** (FR-39). If two source answers materially disagree, the AI must refuse to synthesise. It returns the conflict, states both positions, and requires a human decision. It may never average two incompatible positions into a sentence that hides the disagreement.

The reasoning from `tech_infrastructure.md` §5.6 is worth keeping in front of you while building this:

> A team under time pressure at 4pm in a long session will take the merge button if it exists, and the merged sentence will be the thing nobody follows.

So there is no merge-anyway endpoint. Not hidden behind a confirmation, not behind a feature flag. The absence of the button is the feature.

## Scope

- Official OPSP canvas and the `owner_type = 'official'` draft
- Source cards pulling any respondent's answer into a cell
- Two-step synthesis: classify, then synthesise only if compatible
- Conflict result state with `[Record the decision]`
- Cell-level provenance
- Named version snapshots and PDF export

## Exit criteria

- Two incompatible source answers produce a conflict state, never a sentence
- No API path produces a synthesis from incompatible sources
- Every accepted cell shows which respondents' answers fed it
- Version snapshots are nameable and exportable

## Risks

- The classify step is where this gets gamed. If "compatible" is defined loosely, the guard becomes decorative. The definition to hold: compatible means the two can be stated as one thing **without either party losing something they said**.
