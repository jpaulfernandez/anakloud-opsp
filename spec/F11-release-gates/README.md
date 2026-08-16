# F11 — Release gates & test harness

**Phase:** P1 · **Depends on:** F01–F10 · **Blocks:** F12 (nothing in P2 starts before this is green)

## What this is

Three tests that are specific to this product's actual risks, plus the harness that runs them. `tech_infrastructure.md` §8 names them:

| | Test | Gates |
|---|---|---|
| **T1** | Coach containment — 30 fixture answers, zero banned terms, zero digits, ≤25 words | P2 release |
| **T2** | Key removal — full E2E with `ANTHROPIC_API_KEY` deleted from the environment | **P1 release** |
| **T3** | Lock integrity — property test, every mutation path returns 409 after submit | P1 release |

T2 is the gate that matters most and is the cheapest to run: it is a one-line environment change. It is the real test of PR3, because a system where the AI is "optional" in principle and load-bearing in practice will pass every other test in the suite.

## Scope

- `verify.sh` and the npm scripts it calls
- T2 key-removal E2E
- T3 lock-integrity property test
- T1 coach containment harness (built now, gates P2)
- Build-time check that no AI key reaches the client bundle
- Log redaction test

## Exit criteria

- `./verify.sh` green
- The full E2E suite passes with the key removed: invite → 15 answers → submit → OPSP → PDF → admin comparison → CSV
- T3 passes as a property test, not as a happy-path check

## Risks

- T1 calls the live model and therefore costs money and can flake on latency. Keep it out of the default `verify.sh` run and wire it to prompt changes and P2 release, as specified.
