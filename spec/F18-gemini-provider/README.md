# F18 — Gemini provider

**Phase:** M · **Depends on:** F16, F12, F13 · **Blocks:** F20

## What this is

A Gemini implementation behind the existing vendor-neutral `AIProvider` interface. The gateway, degradation ladder, circuit breaker, timeout, retry policy, budget accounting, and output guard remain unchanged.

Gemini introduces two correctness hazards beyond request mapping: its function declarations accept an OpenAPI subset rather than the current schema dialect, and a safety refusal can arrive as a successful HTTP response with no usable candidate. This feature implements source migration items M06–M08.

## Scope

- Gemini `generateContent` transport using native `fetch`
- Plain and forced-structured output mapping
- Usage metadata and HTTP error mapping
- Schema translation and strict response-shape validation
- Safety-block detection, degradation, logging, and no-retry behaviour

## Exit criteria

- Every current gateway consumer works through `geminiProvider(apiKey)` without changing the gateway contract
- Malformed structured replies and safety blocks degrade normally rather than reaching a browser
- Served L0 interactions record real Gemini token counts
- No respondent sees a provider or safety-block error

## Risks

- **A 200 response is not necessarily a usable response.** Prompt blocks and safety finish reasons must be handled before parsing.
- Schema keywords silently ignored by Gemini can remove the structural guarantee; live fidelity verification complements faked transport tests.
- Safety fixtures must be synthetic. Q14(d) remains private and is never sent to any provider.

