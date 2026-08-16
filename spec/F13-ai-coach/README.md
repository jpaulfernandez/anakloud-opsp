# F13 — AI coach

**Phase:** P2 · **Depends on:** F12, F05 · **Blocks:** —

## What this is

Swapping the *source* of the coach's hints from static strings to a model, without changing the flow, the card, the ceiling, or the three actions — all of which already exist and are already tested from F05.

The design tension is stated plainly in `spec.md` §6.1: an AI that offers an example of a good answer *is* an influence, and if all six respondents see the same example, the tool has manufactured the consensus it was built to detect. The resolution is a hard split — **the AI may operate on the form of an answer and is forbidden the substance.**

Two mechanisms enforce that split, and only one of them is the prompt:

1. **The system prompt** (`tech_infrastructure.md` §5.2) states the constraints.
2. **The output guard** (§5.4) enforces them on every response before it reaches a browser. A prompt is a request, not a guarantee.

When the guard trips, the model output is discarded, the static L2 hint is served, and the trip is logged. There is deliberately no retry: a tripped guard means the prompt is leaking and should surface in the log rather than be papered over.

## Scope

- Coach prompt and structured output schema
- Payload minimisation — one answer, no identity, no history
- Output guard: banned terms, length, digits, verdict sanity
- `/api/coach` never returning 5xx
- Example generation on request only
- The contamination audit query

## Exit criteria

- T1 containment passes across 30 fixtures at L0
- A guard trip serves a normal-looking card and logs the reason
- The coach payload provably contains no name, id, email, or other answer

## Risks

- **This is where PR1 can fail silently.** Everything else in the product either works or visibly doesn't. A leaking coach produces a plausible-looking baseline that has been quietly homogenised. The guard-trip counter and the `answer_changed` audit are the only instruments that will catch it.
