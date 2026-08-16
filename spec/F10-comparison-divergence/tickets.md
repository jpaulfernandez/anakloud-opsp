# F10 — Tickets

---

## F10-T01 — Divergence scoring library

**Phase:** P1 · **Depends:** F01-T07 · **Traces:** FR-31, `spec.md` §10 criterion 11

### Requirements

- The system SHALL compute divergence for every question without calling any AI provider.
- WHERE a question is closed-form (choice, ranking, matrix, numeric), the system SHALL compute exact agreement rate, modal answer, and spread.
- WHERE a question carries confidence, the system SHALL classify it as `aligned`, `soft split` or `hard split` using answer spread × mean confidence.
- WHERE a question is open text, the system SHALL flag it for manual review and report word count and length spread.
- The system SHALL read the split thresholds from configuration with the documented defaults, and SHALL NOT hard-code them at call sites.
- The system SHALL exclude `is_private` rows from all scoring input.
- The scoring functions SHALL be pure and free of I/O.

### Acceptance

- [ ] All closed questions classify with `ANTHROPIC_API_KEY` removed
- [ ] Seeded conflicting data yields at least one of each classification
- [ ] Changing a threshold in config changes the classification without a code change
- [ ] Unit tests cover the boundary between soft and hard split

---

## F10-T02 — Comparison data endpoint

**Phase:** P1 · **Depends:** F10-T01, F09-T01 · **Traces:** `tech_infrastructure.md` §4

### Requirements

- The system SHALL expose `GET /api/admin/question/:qid` returning every respondent's answer to that question plus its deterministic divergence result.
- The system SHALL exclude `is_private` rows at the query layer.
- WHERE the requested mode is anonymised, the system SHALL omit names and respondent identifiers from the response payload entirely.
- The system SHALL NOT return names in the anonymised payload and rely on the client to hide them.

### Acceptance

- [ ] The anonymised response contains no name, email or respondent id under inspection of the raw payload
- [ ] `q14d` is never returned by this route
- [ ] Divergence result present on every question

---

## F10-T03 — Comparison screen

**Phase:** P1 · **Depends:** F10-T02 · **Traces:** FR-30, `ui_ux.md` §4.18

### Requirements

- The system SHALL render answers as cards in a responsive grid at equal height.
- The system SHALL show full answer text without truncation where the viewport allows.
- The system SHALL display the divergence badge — aligned, soft split or hard split — before any AI has run.
- The system SHALL display each answer's confidence value where the question carries one.
- The system SHALL render this view at a tighter density than the questionnaire.

### Acceptance

- [ ] The badge is visible with the AI disabled
- [ ] Long answers are readable without opening a modal
- [ ] Cards align to equal height across a row

---

## F10-T04 — Anonymised and attributed modes

**Phase:** P1 · **Depends:** F10-T03 · **Traces:** FR-30, `spec.md` §10 criterion 12, `ui_ux.md` §4.18

### Requirements

- The system SHALL default the comparison screen to **anonymised** mode.
- WHEN the facilitator switches to attributed mode, the system SHALL require an explicit confirmation reading "This shows names. Don't use this while projecting."
- The system SHALL NOT enter attributed mode as a result of a single click, a remembered preference, or a URL parameter alone.
- WHILE in anonymised mode, the system SHALL randomise card order on every load, so position cannot be used to infer identity across sessions.
- WHEN the page is reloaded, the system SHALL return to anonymised mode.

### Acceptance

- [ ] Two loads of the same question in anonymised mode show different card orders
- [ ] Attributed mode is unreachable without passing the confirmation
- [ ] Reload from attributed mode returns to anonymised

---

## F10-T05 — CSV export

**Phase:** P1 · **Depends:** F10-T02 · **Traces:** FR-34, `spec.md` §8, `tech_infrastructure.md` §4, §9

### Requirements

- The system SHALL expose `GET /api/admin/export` producing a CSV of all answers.
- The system SHALL exclude `is_private` rows at the query layer.
- IF the facilitator requests inclusion of private rows, THEN the system SHALL require an explicit re-confirmation and SHALL record that the export occurred.
- The system SHALL include confidence values and divergence classifications.
- The system SHALL produce a CSV that opens correctly in a spreadsheet with non-ASCII and multi-line answer text intact.

### Acceptance

- [ ] Default export contains no Q14(d) content
- [ ] Taglish and multi-line answers survive a round trip through a spreadsheet
- [ ] The re-confirmation path is logged

---

## F10-T06 — Projection sheet export

**Phase:** P1 · **Depends:** F10-T04, F08-T01 · **Traces:** FR-34, `ui_ux.md` §4.18

### Requirements

- The system SHALL produce a projection-ready comparison sheet suitable for display during the session.
- The projection sheet SHALL be anonymised unconditionally.
- The projection sheet SHALL NOT contain names, emails, respondent identifiers or private rows under any option.
- The system SHALL render it legibly at projector distance, using the print stylesheet conventions.

### Acceptance

- [ ] No option produces an attributed projection sheet
- [ ] Text is legible when displayed at typical projection sizes
- [ ] Private rows absent, verified against seeded private content
