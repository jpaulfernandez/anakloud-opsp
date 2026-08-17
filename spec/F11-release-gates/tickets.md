# F11 — Tickets

---

## F11-T01 — Verification script and npm scripts

**Phase:** P1 · **Depends:** F01-T01 · **Traces:** `tech_infrastructure.md` §8

### Requirements

- The system SHALL provide `verify.sh` at the repository root, executable, running typecheck, lint, unit tests and Playwright in that order.
- The system SHALL fail the script on the first failing step.
- The system SHALL NOT include the T1 live-model test in the default `verify.sh` run.
- The system SHALL make `verify.sh` runnable without network access to any AI provider.

### Acceptance

- [ ] `./verify.sh` exits non-zero if any step fails, and stops at the first failure
- [ ] The script passes with `GEMINI_API_KEY` unset
- [ ] File mode is executable in version control

---

## F11-T02 — T2 key-removal end-to-end test

**Phase:** P1 · **Depends:** F01–F10 · **Traces:** PR3, `spec.md` §10 criterion 6, `tech_infrastructure.md` §8

### Requirements

- The system SHALL provide an E2E run executed with the active AI credential (`GEMINI_API_KEY`, renamed from `ANTHROPIC_API_KEY` by F16-T03) entirely absent from the environment.
- That run SHALL cover: claim an invite, answer all fifteen questions, submit, view the OPSP, export a PDF, open the admin comparison, and download the CSV.
- Every one of those steps SHALL pass.
- IF any step depends on the AI provider, THEN the test SHALL fail, and the dependency SHALL be treated as a defect rather than an accepted limitation.
- The system SHALL make this run a single documented command.

### Acceptance

- [ ] The full journey passes with no key present
- [ ] No respondent-visible error, banner or spinner appears during the run
- [ ] The command is recorded in `AGENTS.md` and runnable by any contributor

**Note.** This is the P1 gate. Nothing in P2 begins until it is green.

---

## F11-T03 — T3 lock integrity property test

**Phase:** P1 · **Depends:** F06-T04 · **Traces:** PR5, FR-14, `tech_infrastructure.md` §8

### Requirements

- The system SHALL property-test that, after submit, every mutation path against `answers` returns 409.
- The test SHALL enumerate mutation routes programmatically rather than listing them by hand, so a route added later is covered automatically.
- The test SHALL assert that `answer_snapshots` rows are unchanged after all attempted mutations.
- The test SHALL cover the post-unlock, pre-resubmit state as well as the locked state.

### Acceptance

- [ ] Adding a new mutation route without lock enforcement fails the test
- [ ] Snapshot bytes are identical before and after the mutation attempts
- [ ] The test is generative, not a fixed list of happy-path calls

---

## F11-T04 — T1 coach containment harness

**Phase:** P2 gate, built in P1 · **Depends:** F05-T02 · **Traces:** `spec.md` §10 criterion 8, `tech_infrastructure.md` §8, §5.4

### Requirements

- The system SHALL provide 30 fixture answers spanning every coachable question, including deliberately vague ones.
- The system SHALL run each fixture through the coach at L0 and assert: zero banned terms in any hint or example, zero digits in any hint, and no hint exceeding 25 words.
- The system SHALL run the same assertions against every string in `lib/static-hints.ts`, with no model call required.
- The system SHALL require this test to pass on every change to a prompt or to the static hint set.
- The system SHALL NOT include the live-model portion in the default `verify.sh` run.

### Acceptance

- [ ] The static-hint portion runs offline and is part of the unit suite
- [ ] The live portion is a separate command, documented, and gates P2 release
- [ ] A deliberately leaking prompt fails the test

---

## F11-T05 — Client bundle key check

**Phase:** P1 · **Depends:** F01-T01 · **Traces:** `spec.md` §8, `tech_infrastructure.md` §9

### Requirements

- The system SHALL verify at build time that no AI API key value or key-bearing environment variable is present in any client bundle.
- IF a key reference is found in client output, THEN the build SHALL fail.
- The system SHALL make all AI calls server-side only.

### Acceptance

- [ ] Deliberately referencing the key in a client component fails the build
- [ ] The check runs as part of the standard build, not as an optional step

---

## F11-T06 — Log redaction test

**Phase:** P1 · **Depends:** F05-T05 · **Traces:** `spec.md` §8, `tech_infrastructure.md` §9, §11

### Requirements

- The system SHALL NOT write answer text to application logs at any level.
- The system SHALL NOT write invite tokens, resume codes, or session cookie values to logs.
- The system SHALL log AI calls with purpose, level served, latency, token counts and guard result only.
- The system SHALL provide a test that exercises the main flows and asserts no seeded answer text appears in captured log output.

### Acceptance

- [ ] A distinctive seeded answer string is absent from all captured logs after a full run
- [ ] Structured AI log entries contain the five permitted fields and no content
- [ ] Token and code values absent under grep
