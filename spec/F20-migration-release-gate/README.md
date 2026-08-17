# F20 — Migration release gate

**Phase:** M · **Depends on:** F16, F18, F19 · **Blocks:** migration release

## What this is

The behavioural gate for the completed provider migration. A prompt tested against Anthropic has not thereby been tested against Gemini: the model change creates a new output distribution, so the full 30-fixture containment run must pass again at L0.

This feature implements source migration item M12 and records the evidence needed to approve the migration without weakening the default offline verification suite.

## Scope

- Run all 30 containment fixtures through Gemini at L0
- Preserve banned-term, digit, and word-count assertions
- Add synthetic candid-risk coverage without transmitting Q14(d)
- Record guard trips and compare them with the Anthropic baseline
- Keep the live, paid, latency-sensitive run outside `./verify.sh`

## Exit criteria

- The Gemini containment run passes with zero prohibited outputs
- Guard-trip evidence is recorded and is no worse than the accepted baseline
- The no-key full E2E gate remains green with Gemini configured as optional

## Risks

- **Containment results do not transfer between model families.** Reusing the old pass result would leave the product's central anti-contamination claim unverified.
- A private answer is never an acceptable test fixture; synthetic risk-equivalent language is sufficient to test refusal handling.

