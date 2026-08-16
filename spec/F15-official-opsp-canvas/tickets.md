# F15 — Tickets

---

## F15-T01 — Official OPSP canvas

**Phase:** P4 · **Depends:** F07-T02 · **Traces:** FR-36, `ui_ux.md` §4.20

### Requirements

- The system SHALL provide a collaborative OPSP canvas using the same grid as the individual OPSP.
- The system SHALL persist it as an `opsp_drafts` row with `owner_type = 'official'`.
- The system SHALL scope the official OPSP to one per cohort.
- The system SHALL restrict authoring to the facilitator.

### Acceptance

- [ ] The canvas renders with the same cell structure as the individual OPSP
- [ ] A non-facilitator cannot write to it
- [ ] One cohort has at most one official OPSP lineage

---

## F15-T02 — Source cards

**Phase:** P4 · **Depends:** F15-T01 · **Traces:** FR-37, `ui_ux.md` §4.20

### Requirements

- The system SHALL allow the facilitator to attach any respondent's answer to any cell as a source card via `[+ Add someone's answer]` and a picker.
- The system SHALL display attached source cards under the cell, attributed to the respondent.
- The system SHALL NOT offer `is_private` rows in the picker.
- The system SHALL allow removing a source card without altering the underlying answer.

### Acceptance

- [ ] `q14d` never appears in the picker
- [ ] Removing a source card leaves the answer untouched
- [ ] Attribution is visible on each card

---

## F15-T03 — Compatibility classification

**Phase:** P4 · **Depends:** F15-T02, F12-T01 · **Traces:** FR-39, `tech_infrastructure.md` §5.6

### Requirements

- WHEN 2 or more source cards are attached and synthesis is requested, the system SHALL first classify compatibility, returning `{ compatible, reason }`.
- The system SHALL define compatible as: the sources can be stated as one thing without either party losing something they said.
- The system SHALL run classification as a separate step from synthesis, not as part of one call.
- The system SHALL record the classification result and its reason.

### Acceptance

- [ ] Classification is a distinct call with its own logged interaction row
- [ ] Two clearly incompatible seeded answers classify as incompatible
- [ ] The reason string is shown to the facilitator

---

## F15-T04 — Synthesis with the conflict guard

**Phase:** P4 · **Depends:** F15-T03 · **Traces:** FR-38, FR-39, FR-40, `tech_infrastructure.md` §5.6

### Requirements

- WHERE classification returns compatible, the system SHALL draft one statement for the cell.
- IF classification returns incompatible, THEN the system SHALL refuse to synthesise and SHALL return the conflict with both positions stated.
- The system SHALL NOT provide an override path, a force flag, or a "merge anyway" endpoint.
- The system SHALL mark every AI-drafted cell as a draft.
- The system SHALL require explicit human acceptance before a drafted cell enters the official OPSP.

### Acceptance

- [ ] No route, parameter or flag produces a synthesis from incompatible sources
- [ ] A drafted cell is visibly a draft until accepted
- [ ] Accepting is an explicit action, never automatic

**Note.** The absence of the override is the requirement. Do not add one behind a confirmation dialog, an admin setting, or a feature flag.

---

## F15-T05 — Conflict result state

**Phase:** P4 · **Depends:** F15-T04 · **Traces:** FR-39, `ui_ux.md` §4.20

### Requirements

- WHEN synthesis is refused, the system SHALL display both positions side by side with the prompt "These two don't reconcile. Someone has to choose."
- The system SHALL offer a `[Record the decision]` action.
- The system SHALL NOT display any control that would merge the positions.
- WHEN a decision is recorded, the system SHALL store it as the cell content with a note of which position was chosen and by whom.

### Acceptance

- [ ] The conflict state contains no merge affordance
- [ ] Recording a decision captures the chosen position and the decider
- [ ] Both positions remain visible after the decision is recorded

---

## F15-T06 — Cell provenance

**Phase:** P4 · **Depends:** F15-T04 · **Traces:** FR-41, `ui_ux.md` §4.20

### Requirements

- The system SHALL record, per official OPSP cell, which respondents' answers fed it and from which questions.
- The system SHALL display provenance on accepted cells, e.g. "from Ern (Q7), Paul (Q7)".
- The system SHALL retain provenance across version snapshots.
- The system SHALL retain provenance for cells resolved by recorded decision as well as by synthesis.

### Acceptance

- [ ] Provenance renders on every accepted cell
- [ ] Provenance survives a snapshot and reload
- [ ] Decision-resolved cells carry provenance too

---

## F15-T07 — Versioning and export

**Phase:** P4 · **Depends:** F15-T01 · **Traces:** FR-42

### Requirements

- The system SHALL support named version snapshots of the official OPSP, e.g. "Q4 2026 v1".
- The system SHALL NOT modify a snapshot after it is taken.
- The system SHALL provide PDF export of the official OPSP using the F08 print pipeline.
- The system SHALL exclude `is_private` rows from every official OPSP export.

### Acceptance

- [ ] Taking a snapshot and continuing to edit leaves the snapshot unchanged
- [ ] Export renders through the shared print stylesheet
- [ ] No private content reaches the export
