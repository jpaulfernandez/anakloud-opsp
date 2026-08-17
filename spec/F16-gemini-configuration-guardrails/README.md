# F16 — Gemini configuration guardrails

**Phase:** M · **Depends on:** F11, F12 · **Blocks:** F18, F20

## What this is

The safety rails that must point at Gemini before the provider changes. The current model-pin check only rejects whole-string aliases, the bundle scan names the Anthropic key directly, and the key-removal gate unsets the old variable. Landing a Gemini provider first would make all three checks appear green while proving the wrong thing.

This feature implements source migration items M09–M11 in their required order.

## Scope

- Reject moving Gemini model aliases while preserving the existing boot-time failure
- Scan client output for every supported AI key name and populated value
- Rename the active provider credential to `GEMINI_API_KEY`
- Retarget the no-key E2E gate, containment command, configuration docs, and tests

## Exit criteria

- Moving Gemini aliases cannot boot the application
- A Gemini key name or value in client output fails the build
- The complete user journey passes with `GEMINI_API_KEY` absent
- The old key cannot silently win when both variables are present

## Risks

- **A green guard aimed at an unused variable is a false guarantee.** The bundle test must prove that every configured AI key name is part of the scan.
- Model-name rules must reject moving aliases without treating every legitimate pinned identifier as invalid.

