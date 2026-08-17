# F16 — Tickets

---

## F16-T01 — Reject moving Gemini model aliases

**Phase:** M · **Depends:** F01-T06 · **Source item:** M09 · **Traces:** `EXECUTION-NEON.md` M09, `tech_infrastructure.md` §10

### Requirements

- The system SHALL reject an `AI_MODEL` value ending in a moving suffix, including `-latest` and `-preview`.
- The system SHALL continue to reject every whole-string alias rejected before the migration.
- The system SHALL reject a bare Gemini family name when that family provides a separately versioned pinned identifier.
- IF `AI_MODEL` is not pinned, THEN the system SHALL fail at boot.
- The system SHALL document an accepted pinned Gemini identifier form in `.env.example` without making it the runtime default.

### Acceptance

- [ ] `gemini-flash-latest` is rejected
- [ ] `gemini-2.5-flash-latest` is rejected
- [ ] A pinned dated or numbered Gemini identifier is accepted
- [ ] Existing whole-string alias cases remain rejected
- [ ] `tests/unit/config.test.ts` covers suffix, bare-family, and pinned cases

---

## F16-T02 — Retarget the client-bundle key guard

**Phase:** M · **Depends:** F16-T01, F11-T05 · **Source item:** M10 · **Traces:** `EXECUTION-NEON.md` M10, `spec.md` §8

### Requirements

- The system SHALL scan client output for the `GEMINI_API_KEY` environment-variable name and its populated value.
- The system SHALL continue to scan for the legacy `ANTHROPIC_API_KEY` name and any populated value during the migration, so a stale reference cannot escape detection.
- WHERE another AI key environment variable is introduced, the system SHALL add its name and populated value to the same scan target list.
- IF any scanned key name or value occurs in client output, THEN the system SHALL fail the build.
- The system SHALL keep the client-bundle check in the standard build command.
- The system SHALL test that the configured scan targets include every AI key environment variable the server reads.

### Acceptance

- [ ] Deliberately referencing `GEMINI_API_KEY` in a client component fails the build
- [ ] Deliberately placing its populated value in client output fails the build
- [ ] A stale `ANTHROPIC_API_KEY` reference in client output still fails the build
- [ ] The unit suite fails when an active AI key variable is omitted from the scan targets
- [ ] `npm run build` continues to run the check

---

## F16-T03 — Rename the provider credential

**Phase:** M · **Depends:** F16-T02, F11-T02 · **Source item:** M11 · **Traces:** `EXECUTION-NEON.md` M11, F01-T01, F01-T06, F11-T02, `tech_infrastructure.md` §10

### Requirements

- The system SHALL read `GEMINI_API_KEY` across configuration, server routes, scripts, and tests that invoke the AI provider.
- IF `GEMINI_API_KEY` is absent, THEN the system SHALL boot normally and SHALL NOT log the absence above `debug`.
- IF both `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` are set during the migration, THEN the system SHALL use `GEMINI_API_KEY` and SHALL NOT silently prefer the old credential.
- The system SHALL document the key-removal gate as `env -u GEMINI_API_KEY npx playwright test --reporter=line` in `AGENTS.md` and F11.
- The system SHALL update `docs/tech_infrastructure.md` §10 with a dated migration note identifying `GEMINI_API_KEY` as the active optional credential.
- The system SHALL NOT make AI availability a prerequisite for any user-facing workflow.

### Acceptance

- [ ] Active code, routes, scripts, and tests contain no provider lookup through `ANTHROPIC_API_KEY`
- [ ] Historical mentions of `ANTHROPIC_API_KEY` in `spec/` or `docs/` are explicitly labelled historical
- [ ] `env -u GEMINI_API_KEY npx playwright test --reporter=line` passes the full journey
- [ ] Booting without `GEMINI_API_KEY` emits nothing above `debug`
- [ ] With both variables set, a faked request proves the Gemini credential is selected
