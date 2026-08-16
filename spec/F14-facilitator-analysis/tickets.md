# F14 — Tickets

---

## F14-T01 — Analysis prompt and payload

**Phase:** P3 · **Depends:** F12-T01 · **Traces:** FR-32, `spec.md` §6.4, `tech_infrastructure.md` §5.5

### Requirements

- The system SHALL use the facilitator-analysis prompt from `tech_infrastructure.md` §5.5.
- The system SHALL structure output as: where they agree, where they don't, what to ask in the room.
- The analysis SHALL state each conflicting position in the respondents' own words where possible.
- The analysis SHALL NOT merge, soften, rank or adjudicate between positions.
- The analysis SHALL NOT recommend a strategy or say which view is better.
- WHERE a disagreement appears to be a difference in wording rather than substance, the system SHALL say so explicitly — this is the one judgement permitted.
- The payload SHALL refer to respondents as A, B, C and SHALL exclude names, emails and identifiers.
- The payload SHALL exclude every `is_private` row.

### Acceptance

- [ ] A captured payload contains no name, email or respondent id
- [ ] `q14d` content never reaches the provider, verified against seeded private data
- [ ] Output for a hard-split fixture states both positions without picking one
- [ ] Output includes 2–3 concrete questions to ask in the room

---

## F14-T02 — Analysis endpoint with degradation

**Phase:** P3 · **Depends:** F14-T01, F10-T01 · **Traces:** FR-32, `spec.md` §7, `tech_infrastructure.md` §4

### Requirements

- The system SHALL expose `POST /api/admin/analyse` accepting a single question or the whole cohort.
- WHILE at L1, the system SHALL queue the analysis and retry it in the background.
- WHILE at L2 or L3, the system SHALL return the deterministic divergence breakdown and export options instead.
- The system SHALL NOT return an error when AI is unavailable; it SHALL return the deterministic result.
- The endpoint SHALL be subject to the admin gate (F09-T01).

### Acceptance

- [ ] With the key removed, the endpoint returns scoring data and a 200
- [ ] At L1 a queued analysis eventually completes without user action
- [ ] An unsubmitted facilitator cannot call it

---

## F14-T03 — Analysis side panel

**Phase:** P3 · **Depends:** F14-T02, F10-T03 · **Traces:** FR-32, FR-35, `ui_ux.md` §4.19

### Requirements

- The system SHALL open the analysis as a side panel and SHALL NOT replace or obscure the raw answers.
- The system SHALL keep the answers visible beside the analysis at all times, so the facilitator can check the read against the source.
- The system SHALL display, in the panel footer, the model name, the timestamp and a `[Re-run]` action.
- The system SHALL display a standing label: "Prep material. Not a finding to show the team."
- WHERE the level is L2 or L3, the system SHALL replace the panel with the deterministic scoring breakdown and an export button, presented as its own feature rather than as a downgrade.

### Acceptance

- [ ] Answers remain on screen at every viewport width while the panel is open
- [ ] Model name and timestamp are present on every output
- [ ] The L2 panel contains no error language, no "unavailable", no retry spinner
- [ ] Re-run produces a new labelled output without discarding the previous one

---

## F14-T04 — Individual OPSP strengths and gaps

**Phase:** P3 · **Depends:** F14-T01, F07-T01 · **Traces:** FR-33, `spec.md` §6.4

### Requirements

- The system SHALL produce, for one respondent's OPSP, a read identifying which cells are internally consistent, which contradict each other, and which are unfalsifiable.
- The system SHALL restrict this feature to the facilitator.
- The system SHALL NOT expose this analysis to the respondent whose OPSP it concerns.
- The system SHALL label the output with model and timestamp and mark it as prep material.
- The payload SHALL exclude `is_private` rows.

### Acceptance

- [ ] A respondent cannot reach this analysis for their own OPSP by any route
- [ ] A seeded self-contradicting OPSP produces a contradiction finding
- [ ] Output is labelled and re-runnable

---

## F14-T05 — Anonymised projection hardening

**Phase:** P3 · **Depends:** F10-T04 · **Traces:** FR-30, `spec.md` §10 criterion 12, `ui_ux.md` §4.18

### Requirements

- The system SHALL NOT allow anonymised mode to be exited without an explicit confirmation.
- The system SHALL NOT persist attributed mode across a page load, a navigation, or a session.
- The system SHALL re-randomise card order on every load in anonymised mode.
- The system SHALL NOT include names in the anonymised response payload, so a client-side inspection cannot recover them.
- IF an analysis is run while in anonymised mode, THEN its output SHALL also be free of names.

### Acceptance

- [ ] Attributed mode is unreachable by URL manipulation alone
- [ ] Names are absent from the network payload in anonymised mode
- [ ] Analysis output in anonymised mode uses A/B/C labels only

---

## F14-T06 — Output labelling and re-run

**Phase:** P3 · **Depends:** F14-T02 · **Traces:** FR-35

### Requirements

- The system SHALL label every AI analysis output with the model identifier used and the timestamp of generation.
- The system SHALL make every analysis re-runnable.
- The system SHALL retain previous outputs rather than overwriting them, so a change in the read is visible.
- The system SHALL record the serving level alongside each output.

### Acceptance

- [ ] Re-running preserves the prior output and its label
- [ ] A model change between runs is visible in the labels
- [ ] Level is recorded per output
