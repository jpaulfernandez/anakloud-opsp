# F18 — Tickets

---

## F18-T01 — Implement the Gemini provider

**Phase:** M · **Depends:** F16-T03, F12-T01 · **Source item:** M06 · **Traces:** `EXECUTION-NEON.md` M06, `tech_infrastructure.md` §5.1, §5.3, F12-T01, F13-T01

### Requirements

- The system SHALL implement `geminiProvider(apiKey)` with the existing `AIProvider` request and response shapes.
- The system SHALL make `geminiProvider` the active provider for every gateway consumer that previously constructed the Anthropic provider.
- The system SHALL call `POST /v1beta/models/{model}:generateContent` and SHALL send the credential only in the `x-goog-api-key` header.
- The system SHALL map the system prompt, user content, output-token cap, and structured-output declaration to Gemini's request fields.
- WHERE Gemini returns a structured function call, the system SHALL serialise its arguments to `ProviderResponse.text` as JSON before the output guard runs.
- The system SHALL populate `inputTokens` and `outputTokens` from Gemini usage metadata.
- IF Gemini returns a non-2xx status, THEN the system SHALL throw `ProviderHttpError` with the original status.
- The system SHALL keep each call inside the gateway's existing six-second timeout and SHALL NOT add a vendor SDK dependency.

### Acceptance

- [ ] Faked-transport tests cover plain output, structured output, 429, 503, 500, network failure, and malformed response bodies
- [ ] Authentication appears in the header and never in the URL
- [ ] A served L0 call records non-zero token counts
- [ ] Every AI route reaches Gemini through the existing gateway and no route constructs the Anthropic provider
- [ ] Existing gateway tests pass without changing the gateway contract

---

## F18-T02 — Preserve structured-output schema fidelity

**Phase:** M · **Depends:** F18-T01, F13-T01 · **Source item:** M07 · **Traces:** `EXECUTION-NEON.md` M07, `tech_infrastructure.md` §5.3

### Requirements

- The system SHALL express the coach shape `{ verdict, dimension, hint, example }` using only schema features Gemini accepts.
- The system SHALL constrain `verdict` to `ok | needs_work` and `dimension` to the four configured coach dimensions.
- WHEN Gemini returns a structured function call, the system SHALL validate the complete argument shape before serialising it for the guard.
- IF the arguments do not match the declared shape, THEN the system SHALL treat the response as a provider failure and SHALL NOT pass a partial object to the output guard or browser.
- The system SHALL verify schema fidelity through automated tests and one documented live-endpoint check.

### Acceptance

- [ ] A deliberately non-conforming reply degrades without reaching the browser
- [ ] Tests prove every required field and enum is enforced before the response reaches the guard
- [ ] A live check confirms Gemini honours the verdict and dimension enums
- [ ] The validated shape matches the shape previously produced through Anthropic

---

## F18-T03 — Handle Gemini safety blocks

**Phase:** M · **Depends:** F18-T02, F13-T04 · **Source item:** M08 · **Traces:** `EXECUTION-NEON.md` M08, PR6, `spec.md` §7, §8

### Requirements

- WHEN Gemini returns a safety finish reason or prompt block, the system SHALL treat it as a provider failure and SHALL serve the deterministic L2 result.
- The system SHALL record a safety block distinctly from HTTP failures and output-guard trips in `ai_interactions`.
- The system SHALL NOT retry a safety-blocked request.
- The system SHALL NOT reveal the block or any provider failure to the respondent.
- The system SHALL NOT relax Gemini safety settings without a separately approved specification change.
- The system SHALL exercise safety handling with synthetic candid-risk fixtures, including pre-mortem and walk-away language.
- The system SHALL NOT load, label, or transmit a real `q14d` row, private answer text, respondent identity, or respondent metadata in any safety fixture or provider payload.

### Acceptance

- [ ] A faked safety response yields the same respondent-facing L2 state as an ordinary fallback
- [ ] The safety block is logged and counted separately from HTTP errors and guard trips
- [ ] Exactly one provider request is observed for a safety-blocked response
- [ ] Synthetic pre-mortem and walk-away fixtures exercise the safety path without using private database content or `q14d` metadata
