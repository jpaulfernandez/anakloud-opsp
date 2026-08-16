# F13 — Tickets

---

## F13-T01 — Coach prompt and structured output

**Phase:** P2 · **Depends:** F12-T01 · **Traces:** `spec.md` §6.2, `tech_infrastructure.md` §5.2, §5.3

### Requirements

- The system SHALL use the system prompt given in `tech_infrastructure.md` §5.2 verbatim as its starting point, with changes tracked and re-tested against T1.
- The system SHALL constrain output to the schema `{ verdict, dimension, hint, example }` using the provider's structured-output or tool-use mode, so malformed responses are impossible rather than merely unlikely.
- The coach SHALL NOT suggest a metric, number, customer type, business model, priority, risk, product, or value.
- The coach SHALL NOT mention healthcare, therapy, clinics, doctors, patients, parents, children, schools, teachers, or software products.
- The coach SHALL NOT state or imply that an answer is good, bad, right or wrong.
- The coach SHALL NOT exceed 25 words in `hint`.
- WHEN the verdict is `ok`, the system SHALL return an empty hint and the UI SHALL say nothing.
- The system SHALL bias toward `ok`; a blunt, short, strongly-held answer is usable.

### Acceptance

- [ ] Structured output mode is enforced; free-text responses are impossible
- [ ] A vague fixture answer produces a form-level hint containing no domain noun
- [ ] `verdict: ok` never arrives with a non-empty hint

---

## F13-T02 — Payload minimisation

**Phase:** P2 · **Depends:** F13-T01 · **Traces:** `spec.md` §6.2, §8, `tech_infrastructure.md` §5.1, §9

### Requirements

- The system SHALL send only question metadata and the answer text under evaluation.
- The system SHALL NOT send the respondent's name, id, email, or any other answer by that respondent.
- The system SHALL NOT send any other respondent's answers.
- The system SHALL NOT send any `is_private` content to any AI provider under any circumstances.
- Each coach call SHALL be stateless and SHALL see exactly one answer.

### Acceptance

- [ ] A test captures the outbound payload and asserts absence of name, id, email and any second answer
- [ ] `q14d` content never appears in a captured payload, including when Q14 itself is evaluated
- [ ] Two consecutive calls share no conversational state

---

## F13-T03 — Output guard

**Phase:** P2 · **Depends:** F13-T01 · **Traces:** `tech_infrastructure.md` §5.4, §11

### Requirements

- The system SHALL run the output guard on every coach response before it reaches the browser.
- The guard SHALL perform a case-insensitive, stem-matched banned-term scan on `hint` and `example` covering: therapy, therapist, clinic, clinical, doctor, physician, pedia, pediatric, patient, parent, child, children, school, teacher, SPED, referral, center/centre, app, platform, software, subscription, SaaS, user, and the four app names.
- The guard SHALL reject a `hint` exceeding 25 words.
- The guard SHALL reject a `hint` containing any digit, because a number in a hint is a suggested target.
- The guard SHALL reject `verdict: "ok"` arriving with a non-empty hint.
- IF any check fails, THEN the system SHALL discard the model output, serve the static L2 hint for that question, and record `guard_tripped` with the failing check.
- The system SHALL NOT retry after a guard trip.
- WHEN a guard trips, the respondent SHALL see a normal coach card with no indication that anything was rejected.

### Acceptance

- [ ] Each of the four checks has a unit test that trips it
- [ ] A tripped guard produces the static hint and a logged reason
- [ ] No retry occurs after a trip
- [ ] The respondent-visible card is identical to an ordinary L2 card

**Note.** This is the enforcement. The prompt is the request. Treat a rising guard-trip count as a leaking prompt, not as noise.

---

## F13-T04 — Coach endpoint resilience

**Phase:** P2 · **Depends:** F13-T03, F12-T05 · **Traces:** PR3, PR6, `spec.md` §10 criterion 7, `tech_infrastructure.md` §6.2

### Requirements

- `/api/coach` SHALL NOT return a 5xx status under any condition.
- IF the model cannot serve a response within 6 seconds, THEN the system SHALL return a deterministic verdict served at a lower level.
- The system SHALL indicate the serving level in the response body for logging purposes, and the UI SHALL NOT surface it to the respondent.
- The system SHALL NOT display an error, a retry control, or a spinner beyond the brief inline pending state on Continue.

### Acceptance

- [ ] Fuzzing the provider with every error class yields no 5xx from `/api/coach`
- [ ] A forced 7-second latency yields a hint within the pending-state budget
- [ ] No respondent-facing string in the codebase references AI availability

---

## F13-T05 — Examples on request only

**Phase:** P2 · **Depends:** F13-T01 · **Traces:** FR-18, FR-19, `spec.md` §6.2, `ui_ux.md` §5.2

### Requirements

- The system SHALL request an example only when the respondent explicitly asks for one.
- WHERE an example is generated, it SHALL come from a neutral domain: a bakery, gym, laundry, courier, or hardware store.
- The system SHALL present the example labelled as a shape rather than a suggestion, using the framing in `ui_ux.md` §5.2.
- The system SHALL return at most one example per request.
- IF the generated example touches any prohibited domain, THEN the guard SHALL reject it and the static example SHALL be served instead.

### Acceptance

- [ ] No example is generated unless requested, verified against the interaction log
- [ ] Example framing includes the "yours will be about Anakloud, not deliveries" style closing
- [ ] A prohibited-domain example is replaced by the static one

---

## F13-T06 — Contamination audit

**Phase:** P2 · **Depends:** F12-T06, F05-T05 · **Traces:** FR-20, `tech_infrastructure.md` §3

### Requirements

- The system SHALL provide a query answering: among coached answers where an example was shown, did answers converge more than among uncoached ones?
- The system SHALL surface the result to the facilitator after the cohort completes.
- The system SHALL compute convergence using the deterministic divergence scoring from F10-T01, not an AI judgement.
- The system SHALL make the query runnable against historical cohorts.

### Acceptance

- [ ] The query runs against seeded data and returns a comparable figure
- [ ] Results distinguish example-shown from hint-only from uncoached
- [ ] No AI call is involved in producing the audit

**Note.** This is the check that tells you whether PR1 actually held. If coached answers converge more than uncoached ones, the coach is influencing content and the prompt needs tightening — regardless of what the guard-trip count says.
