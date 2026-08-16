# F14 — Facilitator analysis & projection

**Phase:** P3 · **Depends on:** F12, F10 · **Blocks:** —

## What this is

The facilitator-side AI, which operates under looser rules than the coach for a specific reason: there is no contamination risk. The answers are already locked, and the facilitator is the only reader (`spec.md` §6.4).

Looser is not unconstrained. One rule is absolute: **report what the answers say, do not decide who is right.** Positions are stated in the respondents' own words, never merged, softened or ranked. The one judgement the model may make is to say that a disagreement looks like wording rather than substance.

Everything produced here is labelled facilitator prep material. It is never a finding to show the team without the facilitator explicitly choosing to.

## Scope

- Analysis prompt and anonymised payload construction
- `POST /api/admin/analyse` with degradation to scoring-only
- Analysis side panel that never replaces the raw answers
- Individual OPSP strengths/gaps read
- Anonymised projection mode hardening
- Model/timestamp labelling and re-run

## Exit criteria

- The analysis panel sits beside the answers, never on top of them
- At L2/L3 the panel is replaced by the deterministic scoring breakdown, presented as its own feature rather than as a downgrade
- Every output carries model name and timestamp and is re-runnable
- Payloads carry no names and no private rows

## Risks

- The failure mode is subtle: an analysis that adjudicates rather than reports gives the facilitator a conclusion to walk into the room with, which is exactly the thing the baseline exists to prevent them from doing prematurely.
