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

## Live schema-fidelity check (M07, F18-T02)

The faked-transport tests in `tests/unit/provider.test.ts` and the pure suite in
`tests/unit/structured-shape.test.ts` prove the provider rejects a
non-conforming `coach_result` before the output guard sees it. But "Gemini
honours the verdict and dimension enums" is a claim about the *live API*, which
no faked `fetch` can verify. It is confirmed once against a real endpoint —
costs money, needs `GEMINI_API_KEY` and a pinned `AI_MODEL`, so it is **not**
part of `./verify.sh` — whenever the coach schema or model changes:

1. Drive the production coach schema through `geminiProvider` at L0 over a few
   of the §8 T1 fixtures (e.g. run the fixtures in
   `tests/e2e/key-removal.spec.ts` or a handful of `COACH_FIXTURES`).
2. Assert every call **resolves** — a call is rejected with `ProviderShapeError`
   only when Gemini returned args outside `verdict: ok|needs_work` or
   `dimension` not among the four named dimensions (or null). A clean run means
   the API enforced the enums it was given, so the structural guarantee the
   dialect rewrite preserves is real and not inspection.
3. Check the serialised output parses back through `parseCoachResponse` to the
   §5.3 `{verdict, dimension, hint, example}` shape.

A single fixture that resolves is the minimal signal; the deterministic
enum/required coverage lives in the offline suites above. The dangerous case
this guards against is a schema keyword Gemini *silently ignores* (the reason
the dialect in `lib/coach-prompt.ts` avoids array `type` and `null`-in-enum):
a turn where Gemini returns the four-dimension shape through the live validation
is the evidence it honoured the declaration rather than dropping a constraint.

## Risks

- **A 200 response is not necessarily a usable response.** Prompt blocks and safety finish reasons must be handled before parsing.
- Schema keywords silently ignored by Gemini can remove the structural guarantee; live fidelity verification complements faked transport tests.
- Safety fixtures must be synthetic. Q14(d) remains private and is never sent to any provider.

