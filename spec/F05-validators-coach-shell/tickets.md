# F05 — Tickets

---

## F05-T01 — Deterministic validators

**Phase:** P1 · **Depends:** F01-T07 · **Traces:** `spec.md` §7.1, `tech_infrastructure.md` §6.3

### Requirements

- The system SHALL implement validators in `lib/validators.ts` as pure functions with no I/O and no network access.
- The system SHALL expose them as `Record<QuestionId, (v: unknown) => Verdict>` where `Verdict` is `{ ok, dimension?, hint?, example? }`.
- The system SHALL implement these rules:
  - **Q1** — at least 200 characters.
  - **Q3** — metric name non-empty; value parses as a number; unit non-empty.
  - **Q4** — non-empty, ≤140 characters, a single sentence.
  - **Q6** — reason non-empty, at least 8 words, and not a restatement of the selected choice.
  - **Q7** — non-empty, ≤120 characters, at most one conjunction.
  - **Q9** — all three fields non-empty, each at least 4 words.
  - **Q10** — all four parts present; `first_peso` is a future month. IF the model is "not sure yet", THEN the system SHALL treat the answer as complete and SHALL NOT nudge, including when the date is unset.
  - **Q11** — each done-condition contains a digit, a date, or a countable noun, AND does not consist solely of a vague verb from the blocklist (*improve, enhance, optimise, streamline, better, strengthen, level up, polish*).
  - **Q12** — ≤40 characters, at least 2 words.
  - **Q14** — at most 3 functions selected; hours between 0 and 60.
- The system SHALL run validators at **every** degradation level including L0, before any model call.
- The system SHALL NOT make a validator's result depend on any other respondent's answer or on any other answer by the same respondent.

### Acceptance

- [ ] Unit tests cover pass and fail cases for each rule, including the Q11 blocklist and the Q7 conjunction count
- [ ] `lib/validators.ts` imports nothing that performs I/O
- [ ] A validator run is deterministic across repeated invocations
- [ ] "Not sure yet" on Q10 produces `ok`, not a nudge

**Note.** `spec.md` §7.1 requires all four Q10 parts and a future date; `anakloud-baseline-questions.md` Q10 states plainly that "not sure yet" is a real option and "shouldn't be penalised", because an honest not-sure from four people is a clearer signal than four confident guesses. The exemption above reconciles them. Do not remove it to make the validator uniform.

---

## F05-T02 — Static hints and examples

**Phase:** P1 · **Depends:** F05-T01 · **Traces:** `spec.md` §7.1, FR-19, `tech_infrastructure.md` §6.3

### Requirements

- The system SHALL provide a fixed hint string for every validator failure in `lib/static-hints.ts`, written in the coach's tone.
- The system SHALL provide pre-written examples for Q3, Q7 and Q11.
- Every static example SHALL be drawn from a neutral domain — a bakery, gym, laundry, courier, or hardware store.
- Static hints and examples SHALL NOT mention healthcare, therapy, clinics, doctors, patients, parents, children, schools, teachers, or software products, nor any of the four app names.
- Static hints SHALL NOT exceed 25 words and SHALL NOT contain digits.
- The system SHALL subject `lib/static-hints.ts` to the same output guard checks used for model output (F13-T03).

### Acceptance

- [ ] A test runs every static string through the banned-term, length and digit checks and passes
- [ ] Every coachable question has a hint; Q3, Q7 and Q11 have examples
- [ ] Tone reviewed against `ui_ux.md` §5.3 — short, informal, never congratulatory

---

## F05-T03 — Validation endpoint

**Phase:** P1 · **Depends:** F05-T01, F05-T02 · **Traces:** `tech_infrastructure.md` §4, PR3

### Requirements

- The system SHALL expose `POST /api/validate` returning a `Verdict` for one answer.
- `/api/validate` SHALL NOT call any AI provider under any configuration.
- `/api/validate` SHALL remain available at every degradation level including L3.
- The system SHALL respond without any dependency on `ANTHROPIC_API_KEY` (historical; renamed to `GEMINI_API_KEY` by F16-T03) being set.

### Acceptance

- [ ] A test asserts no code path from `/api/validate` reaches the AI gateway module
- [ ] The endpoint responds correctly with the key removed from the environment
- [ ] Latency is bounded by local computation only

---

## F05-T04 — Coach card and nudge state machine

**Phase:** P1 · **Depends:** F05-T03, F03-T01 · **Traces:** FR-16 … FR-19, PR4, `ui_ux.md` §5.1, §5.2, D2

### Requirements

- WHEN the respondent activates Continue on a coachable question and the verdict is `needs_work`, the system SHALL render the coach card **below the field**.
- The coach card SHALL NOT open a modal, take focus from the field, disable the Continue button, or cause the page to jump.
- The system SHALL offer three actions on every nudge including the first: revise, show me an example, and "Keep it as is →".
- The system SHALL display the honest attempt counter, "nudge N of 3".
- The system SHALL NOT nudge more than 3 times on one question.
- WHEN the third nudge is dismissed, the system SHALL replace the card with "Fair enough — going with yours." and SHALL NOT reopen the coach for that question for the remainder of the session.
- IF the answer text is unchanged since the previous evaluation, THEN the system SHALL advance without re-evaluating.
- WHEN the verdict is `ok`, the system SHALL advance silently and SHALL NOT display any success message.
- WHERE an example is requested, the system SHALL expand it within the same card, labelled as a shape rather than a suggestion.
- The system SHALL announce the card via `aria-live="polite"`.

### Acceptance

- [ ] "Keep it as is" is present and functional on nudge 1, asserted by E2E test
- [ ] No coach verdict at any level can leave Continue unavailable
- [ ] Tapping Continue twice on identical text advances on the second tap
- [ ] A passing answer produces no visible coach output at all
- [ ] Focus remains in the textarea when the card appears

**Note.** FR-18 and PR4 are the reason this ticket exists at P1 rather than P2. The gating behaviour must be impossible before the model is ever wired in.

---

## F05-T05 — Interaction logging

**Phase:** P1 · **Depends:** F05-T04, F01-T02 · **Traces:** FR-20, `tech_infrastructure.md` §3

### Requirements

- WHEN any coach interaction occurs, the system SHALL write an `ai_interactions` row recording question, attempt number, verdict, hint text, whether an example was requested, and the level that served it.
- WHEN the respondent subsequently edits the answer, the system SHALL set `answer_changed` on the corresponding row.
- The system SHALL record `level` as `L2` for deterministically served interactions.
- The system SHALL NOT write answer text into application logs; the `ai_interactions` table is the only place coach content is retained.

### Acceptance

- [ ] Three nudges on one question produce three rows with attempt numbers 1, 2, 3
- [ ] Editing after a nudge flips `answer_changed` to true
- [ ] Log output contains no answer text under grep

**Note.** This table is the contamination audit (FR-20, `tech_infrastructure.md` §3). It exists so the facilitator can find out whether the coach pushed answers toward each other. Logging it at L2 from the start means there is a pre-AI baseline to compare against.

---

## F05-T06 — L3 plain-form mode

**Phase:** P1 · **Depends:** F05-T04 · **Traces:** `spec.md` §7, PR6, `ui_ux.md` D3

### Requirements

- WHERE the resolved level is L3, the system SHALL accept every answer without evaluation and SHALL NOT render the coach card.
- WHILE at L3, the system SHALL present a clean questionnaire with no error state, no retry affordance, and no indication that a feature is absent.
- The system SHALL make L3 selectable by facilitator pin.

### Acceptance

- [ ] At L3 the respondent-facing UI contains no reference to a coach, an outage, or a degraded state
- [ ] A respondent cannot distinguish L3 from a questionnaire designed without a coach
- [ ] Pinning L3 takes effect without a redeploy
