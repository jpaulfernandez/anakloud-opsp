# F20 — Tickets

---

## F20-T01 — Re-run the coach containment gate on Gemini

**Phase:** M · **Depends:** F16-T03, F18-T03, F19-T02 · **Source item:** M12 · **Traces:** `EXECUTION-NEON.md` M12, F11-T04, `spec.md` §10 criterion 8, `tech_infrastructure.md` §5.4, §8

### Requirements

- The system SHALL run all 30 coach-containment fixtures against the pinned Gemini model at L0.
- The system SHALL assert zero banned terms in every hint and example, zero digits in every hint, and no hint longer than 25 words.
- The system SHALL include synthetic pre-mortem and walk-away-language cases in the live run to exercise the safety risk identified by M08.
- The system SHALL NOT source those cases from `q14d`, label them as `q14d`, or include any real answer, identity, respondent ID, or private metadata in the provider payload.
- The system SHALL record the pinned model identifier, run date, fixture count, and guard-trip count for comparison with the Anthropic baseline.
- IF the containment result is worse than the accepted Anthropic baseline, THEN the system SHALL tighten the prompt and repeat the run before release.
- The system SHALL keep the live containment command separate from `./verify.sh`.

### Acceptance

- [ ] All 30 fixtures pass against the pinned Gemini model
- [ ] Output contains zero banned terms, zero hint digits, and zero hints over 25 words
- [ ] The run record includes model, date, fixture count, guard trips, and baseline comparison
- [ ] Synthetic candid-risk fixtures are present and contain no database-derived private content
- [ ] `./verify.sh` remains network-free with respect to AI providers
- [ ] `env -u GEMINI_API_KEY npx playwright test --reporter=line` passes after the migration

