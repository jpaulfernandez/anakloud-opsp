# F06 — Tickets

---

## F06-T01 — Review screen

**Phase:** P1 · **Depends:** F04-T01, F03-T01 · **Traces:** FR-13, `ui_ux.md` §4.12

### Requirements

- WHEN the respondent reaches the end of the questionnaire, the system SHALL present all fifteen questions collapsed to answer summaries.
- The system SHALL provide an edit link per question that returns to that question and back to the review screen.
- The system SHALL list unanswered optional questions separately under "You skipped these — that's allowed."
- WHILE any required question is unanswered, the system SHALL render the submit button in a secondary style.
- The system SHALL show the respondent's own Q14(d) content on this screen.

### Acceptance

- [ ] Editing from review returns to review, not to the next question
- [ ] Skipped optional questions appear under their own heading with non-judgemental copy
- [ ] Submit is visually de-emphasised until every required question is answered

---

## F06-T02 — Submit confirmation

**Phase:** P1 · **Depends:** F06-T01 · **Traces:** FR-14, `ui_ux.md` §4.13

### Requirements

- WHEN submit is activated, the system SHALL present a confirmation stating that submitting locks the answers, that this is deliberate, and that the OPSP built from them will still be editable.
- The system SHALL offer `[ Not yet ]` and `[ Submit and lock ]`.
- The system SHALL render the copy from `ui_ux.md` §4.13.
- The system SHALL NOT submit on a single click without this confirmation.

### Acceptance

- [ ] Confirmation copy matches `ui_ux.md` §4.13
- [ ] "Not yet" returns to review with nothing changed
- [ ] No path submits without passing through the confirmation

---

## F06-T03 — Submit, snapshot and OPSP generation

**Phase:** P1 · **Depends:** F06-T02, F07-T01 · **Traces:** FR-14, FR-22, `tech_infrastructure.md` §3, §4

### Requirements

- WHEN `POST /api/submit` succeeds, the system SHALL, in one transaction: set `respondents.submitted_at`, write an `answer_snapshots` row containing the full frozen payload, and generate individual OPSP draft version 1.
- IF any part of that transaction fails, THEN the system SHALL roll back all of it and leave the respondent unsubmitted.
- The system SHALL include `q14d` in the snapshot payload and SHALL mark it such that downstream private-exclusion still applies.
- The system SHALL be idempotent: a second submit for an already-submitted respondent SHALL return the existing state rather than creating a second snapshot.

### Acceptance

- [ ] Submit produces exactly one snapshot and one OPSP draft at version 1
- [ ] A forced failure during OPSP generation leaves `submitted_at` null
- [ ] Double-submit creates no duplicate rows

---

## F06-T04 — Lock enforcement

**Phase:** P1 · **Depends:** F06-T03 · **Traces:** FR-14, PR5, `tech_infrastructure.md` §8 (T3)

### Requirements

- WHILE `submitted_at` is non-null, the system SHALL reject every mutation against that respondent's `answers` rows with HTTP 409.
- The system SHALL apply this to every mutation path, not only the primary autosave route.
- The system SHALL NOT permit the OPSP editing feature (F07-T05) to write to `answers`.
- The system SHALL NOT alter an `answer_snapshots` row after it is written, under any code path.

### Acceptance

- [ ] Property test over all mutation routes × locked state returns 409 in every case
- [ ] A test asserts no code path writes to `answer_snapshots` outside `POST /api/submit`
- [ ] Editing an OPSP cell leaves the underlying answers byte-identical

**Note.** This is T3 in `tech_infrastructure.md` §8. Property-test it. Checking the happy path proves nothing here — the risk is the route someone adds later.

---

## F06-T05 — Facilitator unlock with audit

**Phase:** P1 · **Depends:** F06-T04, F09-T01 · **Traces:** FR-14, `tech_infrastructure.md` §3

### Requirements

- WHERE the caller is the facilitator, the system SHALL permit clearing a respondent's `submitted_at`.
- WHEN an unlock occurs, the system SHALL record `unlocked_by` and `unlocked_at`.
- The system SHALL NOT modify or delete the existing `answer_snapshots` row on unlock.
- WHEN the respondent re-submits after an unlock, the system SHALL write an additional snapshot rather than replacing the original.
- The system SHALL surface unlock events on the facilitator dashboard.

### Acceptance

- [ ] Unlocking then re-submitting yields two snapshot rows, both intact
- [ ] `unlocked_by` names the facilitator who acted
- [ ] A non-facilitator cannot reach the unlock route

---

## F06-T06 — Submitted read-only view

**Phase:** P1 · **Depends:** F06-T03 · **Traces:** `ui_ux.md` §6, FR-14

### Requirements

- WHILE a respondent is submitted, the system SHALL present a read-only view of their answers with a link to their OPSP.
- The system SHALL NOT render editable inputs in this view.
- The system SHALL NOT present the read-only state as an error or a restriction, but as the expected outcome of having finished.
- WHERE the cohort is closed, the system SHALL keep this view and the OPSP and PDF reachable.

### Acceptance

- [ ] No editable control is reachable after submit, including by direct URL
- [ ] The OPSP and PDF remain accessible after the cohort closes
- [ ] Copy reads as completion, not as lockout
