# F09 — Tickets

---

## F09-T01 — Admin gate

**Phase:** P1 · **Depends:** F02-T06, F06-T03 · **Traces:** FR-28, `spec.md` §10 criterion 5, `tech_infrastructure.md` §4

### Requirements

- The system SHALL apply middleware to every `/api/admin/*` route requiring `is_facilitator = true` AND `submitted_at IS NOT NULL` for the calling session.
- IF either condition fails, THEN the system SHALL refuse the request server-side regardless of any client state.
- The system SHALL treat the UI-level check as cosmetic and SHALL NOT rely on it for enforcement.
- The system SHALL NOT provide an environment flag, header, or query parameter that bypasses the gate.

### Acceptance

- [ ] An unsubmitted facilitator receives a refusal from every admin route, tested directly against the API
- [ ] A submitted non-facilitator receives a refusal from every admin route
- [ ] A grep of the codebase finds no bypass flag

---

## F09-T02 — Admin-locked UI state

**Phase:** P1 · **Depends:** F09-T01 · **Traces:** `ui_ux.md` §6

### Requirements

- WHILE the facilitator is unsubmitted, the system SHALL present "Finish your own answers first." with a link into their questionnaire.
- The system SHALL present this as a rule rather than as an error state.
- The system SHALL NOT render partial admin content behind the message.

### Acceptance

- [ ] No answer content is present in the DOM of the locked state
- [ ] Copy reads as a rule, with no error styling
- [ ] The link resumes the facilitator's own session correctly

---

## F09-T03 — Roster dashboard

**Phase:** P1 · **Depends:** F09-T01 · **Traces:** FR-29, `ui_ux.md` §4.17

### Requirements

- The system SHALL display a roster table of name, status (not started / in progress / submitted), progress, last active, and time spent.
- The system SHALL NOT display any answer content on this screen.
- The system SHALL surface unlock events (F06-T05) on this screen.
- The system SHALL render this view at a tighter density than the questionnaire, per `ui_ux.md` §2.

### Acceptance

- [ ] No answer text appears in the response payload for this route, not merely in the rendered view
- [ ] Status transitions correctly for a respondent who starts and then submits
- [ ] Unlock events visible with actor and timestamp

---

## F09-T04 — Level and budget header strip

**Phase:** P1 (shell) / P2 (live data) · **Depends:** F09-T03 · **Traces:** `spec.md` §7, §7.2, `ui_ux.md` §4.17, `tech_infrastructure.md` §11

### Requirements

- The system SHALL display the current degradation level in a header strip on the admin dashboard.
- WHERE the level is L1 or L2, the system SHALL display a plain-language reason, e.g. "Running on rule-based checks — AI budget at 94%."
- The system SHALL display budget used against cap, circuit state, and the count of guard trips.
- The system SHALL surface budget warnings at 70% and at 90%.
- The system SHALL NOT surface any of this to respondents.

### Acceptance

- [ ] At P1, the strip renders showing L2 with an honest reason
- [ ] Warnings appear at the two thresholds
- [ ] No respondent-facing view references level, budget or circuit state

**Note.** Build the strip in P1 with the deterministic level; F12 populates budget and circuit data.

---

## F09-T05 — Cohort lifecycle

**Phase:** P1 · **Depends:** F09-T01 · **Traces:** `spec.md` §8, `tech_infrastructure.md` §3, §9, `ui_ux.md` §6

### Requirements

- The system SHALL allow the facilitator to move a cohort between `draft`, `open` and `closed`.
- WHILE a cohort is `closed`, the system SHALL make all respondent views read-only while keeping OPSPs and PDFs accessible.
- The system SHALL allow the facilitator to pin the AI level for a cohort to L0, L1, L2 or L3, or to leave it automatic.
- The system SHALL provide full cohort deletion as one facilitator action, cascading to every dependent row.
- WHEN deletion is requested, the system SHALL require an explicit confirmation naming the cohort.

### Acceptance

- [ ] Closing a cohort does not break OPSP or PDF access
- [ ] Deletion leaves no orphaned answers, snapshots, drafts, interactions or budget rows
- [ ] Level pin takes effect on the next request without a redeploy
