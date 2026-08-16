# F12 — Tickets

---

## F12-T01 — Gateway module

**Phase:** P2 · **Depends:** F11-T02 green · **Traces:** `tech_infrastructure.md` §2

### Requirements

- The system SHALL route every AI provider call through one gateway module.
- The system SHALL NOT permit any other module to call the provider SDK directly.
- The gateway SHALL apply, in order: level selection, budget check, circuit check, request, timeout, output guard, logging.
- The gateway SHALL run server-side only.
- IF any stage fails, THEN the gateway SHALL return a valid lower-level response rather than propagating an exception to the caller.

### Acceptance

- [ ] A lint rule or test forbids provider SDK imports outside the gateway module
- [ ] Every stage is exercised by unit tests with a faked provider
- [ ] The gateway never throws to its callers

---

## F12-T02 — Level selection

**Phase:** P2 · **Depends:** F12-T01 · **Traces:** `spec.md` §7, `tech_infrastructure.md` §6.1

### Requirements

- The system SHALL evaluate the level per request in this order:
  1. WHERE `cohort.ai_level_pin` is set, use it.
  2. IF the budget is exhausted, THEN L2.
  3. IF the circuit is open, THEN L2.
  4. IF p95 latency over the last 20 calls exceeds 6 seconds, THEN L1.
  5. Otherwise L0.
- WHILE at L1, the system SHALL use deterministic validators only and SHALL NOT offer generated examples.
- WHILE at L2, the system SHALL use deterministic validators plus static hints.
- The system SHALL record the level that actually served each interaction.

### Acceptance

- [ ] Each rule is unit-tested in isolation and in precedence order
- [ ] A pinned level overrides every automatic condition
- [ ] `ai_interactions.level` reflects what served the request, not what was requested

---

## F12-T03 — Circuit breaker

**Phase:** P2 · **Depends:** F12-T02 · **Traces:** `spec.md` §7.2, `tech_infrastructure.md` §6.1

### Requirements

- WHEN three consecutive provider failures occur, the system SHALL open the circuit for 5 minutes and serve L2.
- WHEN the open interval elapses, the system SHALL admit one probe request.
- IF the probe succeeds, THEN the system SHALL close the circuit.
- IF the probe fails, THEN the system SHALL reopen with the interval doubled, capped at 30 minutes.
- The system SHALL persist circuit state in `ai_budget` so it survives a process restart.

### Acceptance

- [ ] Three induced failures open the circuit
- [ ] Backoff doubles and caps at 30 minutes
- [ ] Circuit state survives a restart

---

## F12-T04 — Budget accounting

**Phase:** P2 · **Depends:** F12-T01 · **Traces:** `spec.md` §7.2, `tech_infrastructure.md` §6.4

### Requirements

- The system SHALL enforce per-cohort input and output token caps set at cohort creation.
- The system SHALL enforce a per-respondent coach call ceiling, defaulting to 40.
- The system SHALL enforce per-request output caps of 200 tokens for coach and 1500 for analysis.
- The system SHALL increment token counters **inside the same transaction** as the interaction log row.
- WHEN the cohort budget reaches 100%, the system SHALL open the circuit permanently for that cohort and pin the level to L2.
- The system SHALL NOT produce any respondent-visible change when the budget is exhausted.

### Acceptance

- [ ] A crash injected between the provider response and the commit loses neither the log row nor the counter increment
- [ ] Exceeding the per-respondent ceiling stops coach calls without breaking the questionnaire
- [ ] At 100% budget, the respondent experience is indistinguishable from L2 by design

---

## F12-T05 — Timeout and retry policy

**Phase:** P2 · **Depends:** F12-T01 · **Traces:** `spec.md` §10 criterion 7, `tech_infrastructure.md` §6.2

### Requirements

- The system SHALL apply a 6-second timeout to every provider request.
- The system SHALL retry once, with jittered backoff, on HTTP 429 and 503 only.
- The system SHALL NOT retry a timeout, because a respondent is waiting.
- IF any exception occurs, THEN the system SHALL fall through to the deterministic validator.
- `/api/coach` SHALL NOT return a 5xx to the browser under any condition; it SHALL return a valid coach response served at a lower level.

### Acceptance

- [ ] A 7-second provider response yields a deterministic hint, not an error
- [ ] A 429 is retried once; a timeout is not retried
- [ ] Fuzzing the provider with errors never produces a 5xx from `/api/coach`

---

## F12-T06 — Interaction logging and token capture

**Phase:** P2 · **Depends:** F12-T04, F05-T05 · **Traces:** FR-20, FR-35, `tech_infrastructure.md` §3, §11

### Requirements

- The system SHALL write an `ai_interactions` row for every gateway call, recording purpose, level served, model, verdict, hint text, whether an example was shown, input and output tokens, and any tripped guard.
- The system SHALL record the model identifier used, so a mid-cohort model change is visible in the audit.
- The system SHALL emit a structured log line per call with purpose, level, latency, tokens and guard result.
- The system SHALL NOT write answer text to structured logs.

### Acceptance

- [ ] Every gateway call produces exactly one interaction row
- [ ] Token counts are non-zero for served L0 calls and zero for L2 calls
- [ ] Structured log lines contain no answer content

---

## F12-T07 — Facilitator budget and guard-trip surfacing

**Phase:** P2 · **Depends:** F12-T04, F09-T04 · **Traces:** `spec.md` §7.2, `tech_infrastructure.md` §11

### Requirements

- The system SHALL display current level, budget used against cap, circuit state, and guard-trip count on the facilitator dashboard.
- WHEN budget usage crosses 70%, the system SHALL warn the facilitator.
- WHEN budget usage crosses 90%, the system SHALL warn again, more prominently.
- WHEN guard trips reach 3 within a cohort, the system SHALL alert the facilitator.
- The system SHALL present the level with a plain-language reason, not a code.

### Acceptance

- [ ] Both budget thresholds fire once each, not repeatedly on every request
- [ ] The third guard trip in a cohort raises an alert
- [ ] The reason string is readable by a non-engineer

**Note.** Guard trips are the metric that matters (`tech_infrastructure.md` §11). A rising count means the prompt is leaking domain content into hints — which means the coach is quietly contaminating the baseline, and PR1 is failing silently.
