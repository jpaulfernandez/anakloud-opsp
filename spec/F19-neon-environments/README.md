# F19 — Neon environments

**Phase:** M · **Depends on:** F17 · **Blocks:** F20

## What this is

The deployment and developer workflow around Neon. Preview and hosted E2E runs get disposable branches, production is protected from test traffic, and local Docker remains the offline fallback required by `./verify.sh`.

This feature implements source migration items M04–M05 after the runtime connection behaviour is proven.

## Scope

- Ephemeral Neon branches for preview and hosted E2E
- A hard production-branch exclusion for tests
- Branch creation, configuration, and teardown documentation
- `.env.example` coverage for pooled and direct URLs plus Gemini settings
- Local Docker fallback documentation with `AI_LEVEL_PIN=L2` unchanged

## Exit criteria

- The same E2E suite passes against a Neon branch and local Docker by changing environment values only
- No E2E configuration can target the production branch
- A fresh contributor can configure pooled, direct, AI, and local-fallback variables without encountering a secret in version control

## Risks

- A branch workflow without a production-target guard is an operational footgun.
- Removing Docker entirely would make offline verification depend on an external service and violate the existing test contract.

