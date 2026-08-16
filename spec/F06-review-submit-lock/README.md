# F06 — Review, submit & lock

**Phase:** P1 · **Depends on:** F04, F05 · **Blocks:** F07, F09

## What this is

The moment the baseline becomes a baseline.

PR5 is the principle: **original answers are immutable after submit.** The derived OPSP is editable; the raw answers are not. Without this, people quietly revise their answers toward whatever their generated OPSP made them feel, and what you have is no longer a measurement of six independent positions — it is a measurement of six people reacting to a document.

Lock enforcement is therefore not a UI concern. It is a server-side invariant, property-tested (`tech_infrastructure.md` §8, T3), covering every mutation path rather than the happy one.

## Scope

- Review screen with per-question edit links
- Submit confirmation as a real decision point
- `POST /api/submit` — lock, snapshot, generate OPSP v1
- Lock enforcement across all mutation paths
- Facilitator unlock with audit trail
- Read-only view for submitted respondents

## Exit criteria

- After submit, no respondent-facing path can alter an answer — verified by property test, not by inspection
- `answer_snapshots` holds a frozen payload that a later facilitator unlock does not touch
- Submission generates OPSP draft v1 in the same transaction

## Risks

- The unlock path is the loophole. It exists because a real person will occasionally need it, and it is logged for exactly that reason. The snapshot must remain untouched by it — otherwise the unlock quietly rewrites history.
