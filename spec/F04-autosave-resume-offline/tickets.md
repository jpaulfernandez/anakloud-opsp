# F04 — Tickets

---

## F04-T01 — Answer persistence API

**Phase:** P1 · **Depends:** F01-T02, F02-T06 · **Traces:** FR-7, FR-14, `tech_infrastructure.md` §4

### Requirements

- WHEN a `PATCH /api/answers` request arrives for the session's own respondent, the system SHALL upsert exactly one answer row keyed on `(respondent_id, question_id)`.
- IF the respondent's `submitted_at` is non-null, THEN the system SHALL reject the write with HTTP 409 and SHALL NOT modify any row.
- The system SHALL accept `GET /api/answers` returning all of the caller's own answers, including their own `q14d`.
- The system SHALL validate the payload shape against the question registry before writing.
- The system SHALL NOT accept a `respondent_id` supplied by the client.

### Acceptance

- [ ] A write after submit returns 409 and leaves the row byte-identical
- [ ] A payload of the wrong shape for the question is rejected with 400
- [ ] Passing another respondent's id has no effect

---

## F04-T02 — Debounced autosave and persistent save state

**Phase:** P1 · **Depends:** F04-T01, F03-T01 · **Traces:** FR-7, `ui_ux.md` D4, §6

### Requirements

- WHEN an answer changes, the system SHALL save it after a debounce interval.
- WHEN the respondent navigates away from a question, the system SHALL flush any pending save before the transition completes.
- The system SHALL display save state persistently in a fixed slot, showing "Saving…" while in flight and "✓ Saved" when settled.
- The system SHALL NOT render save state as a toast, a transient banner, or anything that fades.
- IF a save fails, THEN the system SHALL retain the answer locally, continue to accept input, and retry without surfacing an error state that implies data loss.

### Acceptance

- [ ] "✓ Saved" remains on screen indefinitely after a successful save
- [ ] Navigating quickly between questions never drops the last keystroke
- [ ] A forced 500 on the save endpoint does not block answering

---

## F04-T03 — Local mirror and offline mode

**Phase:** P1 · **Depends:** F04-T02 · **Traces:** `ui_ux.md` §6, `tech_infrastructure.md` §2

### Requirements

- The system SHALL mirror answer state to localStorage on every change.
- WHILE the browser is offline, the system SHALL continue to accept answers and SHALL display "Saved on this device — will sync when you're back online."
- WHEN connectivity returns, the system SHALL sync pending answers without respondent action.
- The system SHALL NOT block navigation between questions while offline.
- The system SHALL NOT store `q14d` content in localStorage in plain text beyond the active session.

### Acceptance

- [ ] Answering three questions in airplane mode and reconnecting persists all three
- [ ] The offline message is phrased as reassurance, not as an error
- [ ] localStorage is cleared on submit

---

## F04-T04 — Sync conflict resolution

**Phase:** P1 · **Depends:** F04-T03 · **Traces:** `ui_ux.md` §6

### Requirements

- WHEN local and server state disagree on lock status, the system SHALL take the server's value.
- WHEN local and server state disagree on answer content for an unlocked question, the system SHALL take the local value.
- The system SHALL NOT silently discard text the respondent typed.
- IF the server reports the answer locked while local content is unsaved, THEN the system SHALL surface the local text to the respondent in a read-only form so it is not lost without their knowledge.

### Acceptance

- [ ] Two tabs editing the same question converge without data loss
- [ ] Submitting in tab A and typing in tab B does not silently erase tab B's text
- [ ] Property test over interleaved local/server sequences shows no content loss

---

## F04-T05 — Resume landing

**Phase:** P1 · **Depends:** F04-T01, F02-T03 · **Traces:** FR-8, `ui_ux.md` §3.2

### Requirements

- WHEN a respondent returns via invite link or resume code with a partially complete session, the system SHALL show "Welcome back, {name}. You're on question N of 15." with `[Continue]` and `[Review what I've answered]`.
- WHEN `[Continue]` is activated, the system SHALL navigate to the **first unanswered** question.
- The system SHALL NOT return a returning respondent to Q1 when later questions are unanswered.
- The system SHALL permit jumping back to any answered question from the resume screen.
- WHERE the respondent has already submitted, the system SHALL route to the read-only answer view instead (F06-T06).

### Acceptance

- [ ] Resuming with Q1–Q6 answered lands on Q7
- [ ] Resuming with Q1–Q6 and Q9 answered lands on Q7, not Q10
- [ ] A submitted respondent never re-enters the questionnaire flow
