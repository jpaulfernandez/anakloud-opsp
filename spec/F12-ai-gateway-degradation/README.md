# F12 — AI gateway & degradation ladder

**Phase:** P2 · **Depends on:** F11 green · **Blocks:** F13, F14, F15

## What this is

One chokepoint through which every AI call in the product passes, carrying budget check, circuit breaker, timeout and retry policy, output guard hook, and audit logging.

The structural rule from `tech_infrastructure.md` §2 is the one to hold onto:

> Nothing in the request path from browser to a completed questionnaire touches the AI gateway synchronously in a way that can fail the request. The coach is an enhancement bolted to the side of a form that works without it.

Everything below the gateway can fail — provider outage, rate limit, exhausted credits, a timeout — and the only observable consequence to a respondent is a slightly terser hint. The facilitator sees the level and the reason; the respondent sees nothing (PR6).

## Scope

- Gateway module: single entry point for all provider calls
- Level selection per request
- Circuit breaker with backoff
- Budget accounting inside the interaction-log transaction
- Timeout and retry policy
- `ai_interactions` logging with tokens and guard results
- Facilitator-facing budget warnings and guard-trip alerting

## Exit criteria

- Killing the provider mid-cohort drops the level silently and no respondent sees an error
- Budget counters cannot drift from the interaction log, even across a crash
- The circuit opens after three consecutive failures and recovers by probe

## Risks

- **Budget accounting outside the transaction will drift.** Increment counters in the same transaction as the interaction row, as specified — a crash between the two loses spend and the loss compounds.
- The real threat model here is a retry loop, not normal use. Expected spend for the whole cohort is under a dollar (`tech_infrastructure.md` §6.4). Build the machinery anyway; loops happen.
