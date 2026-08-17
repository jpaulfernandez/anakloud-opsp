# F05 — Deterministic validators & coach shell

**Phase:** P1 · **Depends on:** F03 · **Blocks:** F06, F13

## What this is

**The coach's full behaviour, minus the model.** This is the most important sequencing decision in the plan and it comes straight from `tech_infrastructure.md` §12: build the fallback first, so the model is genuinely optional rather than nominally optional.

If this feature is built well, removing `ANTHROPIC_API_KEY` (historical; renamed to `GEMINI_API_KEY` by F16-T03) costs the product a small amount of hint quality and nothing else. If it is skipped or stubbed, PR3 ("no AI on the critical path") will not survive contact with the deadline, because by the time anyone notices, the AI will be load-bearing.

The nudge state machine, the three actions, the attempt ceiling, the interaction log — all of it lives here, at L2, with no network calls. F13 later swaps the hint *source*, not the flow.

## Scope

- `lib/validators.ts` — pure functions, no I/O
- `lib/static-hints.ts` — pre-written hints and examples in the coach's voice
- `POST /api/validate` — deterministic only, always available
- Coach card component and the nudge state machine
- Interaction logging at L2/L3
- L3 plain-form mode

## Exit criteria

- Every coachable question has a validator, a static hint, and — for Q3, Q7, Q11 — a static example
- The coach card can be driven end to end with the network unplugged
- "Submit as is" is present and functional on nudge 1
- The card is visually identical whether served at L0, L1 or L2

## Risks

- **PR4 is the one to guard.** The coach nudges; it cannot gate. Any code path where the Continue button becomes unavailable because of a coach verdict is a defect, not a stricter reading.
- Static examples are the same for everyone, which is a real anchoring cost. It is documented and accepted (`tech_infrastructure.md` §6.3) — do not try to fix it by generating variety at L2.
