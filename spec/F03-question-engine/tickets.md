# F03 — Tickets

---

## F03-T01 — Question shell and navigation

**Phase:** P1 · **Depends:** F01-T07, F02-T05 · **Traces:** FR-6, FR-8, FR-9, `ui_ux.md` §4.3, D1

### Requirements

- The system SHALL render exactly one question per screen.
- The system SHALL NOT render a list, index, or preview of upcoming questions anywhere in the respondent flow.
- The system SHALL display progress as discrete dots plus an "n of 15" count, and SHALL NOT display a percentage bar.
- The system SHALL display the section label in a smaller, quieter treatment than the question text.
- WHILE a session is unsubmitted, the system SHALL permit backward navigation to any answered question.
- The system SHALL permit forward skipping only for questions marked optional in the registry.
- The system SHALL render the input, coach, confidence and save slots in the order given in `ui_ux.md` §4.3.
- Question text SHALL render at 20–24px on mobile and 28px on desktop; body text SHALL NOT fall below 16px.

### Acceptance

- [ ] No route or view exposes more than one question's content
- [ ] Attempting to skip a required question forward is refused with an explanatory line, not a generic disabled state
- [ ] Progress renders as dots at 360px without wrapping into an unreadable row

---

## F03-T02 — Long text input (Q1, Q13, Q15)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.4, `anakloud-baseline-questions.md` Q1, Q13, Q15

### Requirements

- The system SHALL render an auto-growing textarea with a minimum of six visible lines and a line height of 1.6.
- The system SHALL NOT render placeholder text inside the field.
- WHERE a minimum length applies (Q1: 200 characters), the system SHALL show a counter that counts **up to** the minimum rather than down from a maximum.
- The system SHALL additionally render on Q13 a single-choice control below the textarea with these options: centers wouldn't change their workflow · doctors wouldn't refer through us · ran out of money · the team drifted apart · data privacy or regulatory problem · a competitor got there first · product too complex to onboard · we never picked one thing · other.
- The system SHALL mark Q15 optional.
- The system SHALL NOT run the coach on Q1, Q13 or Q15.

### Acceptance

- [ ] Field grows with content without the page jumping
- [ ] Q1 counter reads "142 of 200" style, not "58 remaining"
- [ ] No placeholder attribute present on any of the three
- [ ] Q13 persists both the free text and the selected cause
- [ ] Q15 can be skipped and appears under "You skipped these" on review

**Note.** `tech_infrastructure.md` §3.1 types Q13 as `{ text }` only. The baseline doc adds the single-choice cause, which feeds the SWT — Threats cell. Extend the payload shape to `{ text, cause }`; the baseline doc wins on question content.

---

## F03-T03 — Sentence completion (Q2)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.5

### Requirements

- On viewports wide enough, the system SHALL render the answer as inline underlined input runs inside the sentence.
- WHEN the viewport is narrow, the system SHALL stack the fragments vertically, each carrying its sentence fragment as a label above it.
- The system SHALL NOT collapse the question into two unlabelled boxes at any viewport width.
- The system SHALL persist the answer as `{ who, because }`.

### Acceptance

- [ ] At 360px each field carries its sentence fragment as a visible label
- [ ] Screen reader announces the sentence structure, not two generic text fields

---

## F03-T04 — Metric triple (Q3)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.6, `tech_infrastructure.md` §3.1

### Requirements

- The system SHALL render four labelled fields: metric name, number, unit, and a one-line "why that one".
- The system SHALL accept digits with thousands separators in the number field and SHALL store a normalised number.
- The system SHALL render `unit` as free text.
- The system SHALL NOT render `unit` as a dropdown, combobox, or any control that enumerates candidate units.
- The system SHALL show the field relationships visually, so metric/number/unit read as one statement rather than three unrelated inputs.

### Acceptance

- [ ] `1,500` entered in the number field stores as `1500`
- [ ] No unit suggestions appear anywhere, including browser autofill hints seeded by the app
- [ ] Answer persists as `{ metric, value, unit, why }`

**Note.** The dropdown prohibition is the whole point of the question. A unit list supplies the options and anchors every respondent to the same measurement vocabulary.

---

## F03-T05 — Matrix grid with mobile pivot (Q5)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.8, §7, `anakloud-baseline-questions.md` Q5

### Requirements

- The system SHALL use exactly these nine rows: pediatrician / developmental pedia · therapy center owner or director · occupational therapist · speech-language pathologist · parent or guardian · school or SPED teacher · the child · LGU or DOH program · HMO or insurer.
- The system SHALL use exactly these four columns: Pays us · Decides to adopt · Uses it most days · Benefits most.
- The system SHALL permit a row to be marked in more than one column, or in none.
- WHEN the viewport is narrow, the system SHALL pivot the 9×4 matrix to column-major and present four sequential screens — pays, decides, uses, benefits — each a nine-item multi-select.
- The system SHALL show a "1 of 4" sub-progress indicator during the pivot so the questionnaire does not appear to have grown.
- WHERE the viewport is wide, the system SHALL render the true grid with sticky headers and full-row hover highlight.
- The system SHALL offer the pivoted form as an explicit toggle on desktop as well, as the accessible path.
- The system SHALL persist the answer as `{ pays, decides, uses, benefits }`, each an array of role identifiers, regardless of which presentation was used.

### Acceptance

- [ ] Both presentations write identical payloads for identical selections
- [ ] The pivot toggle is reachable on desktop by keyboard
- [ ] Sub-progress does not increment the main 15-question progress

---

## F03-T06 — Single choice with required reason (Q6)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.9

### Requirements

- The system SHALL render a radio group of four options followed by a reason textarea.
- WHILE no option is selected, the system SHALL keep the reason field disabled.
- WHEN an option is selected, the system SHALL enable the reason field and make it required.
- IF the respondent attempts to continue with an empty reason, THEN the system SHALL replace the generic blocked state with the line "Add a line about why".
- The system SHALL persist the answer as `{ choice, why }`.

### Acceptance

- [ ] Reason field is inert before a choice is made
- [ ] Blocked continue explains itself in words rather than only greying out

---

## F03-T07 — Tap-to-assign ranking (Q8)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.7, §7

### Requirements

- The system SHALL render the four apps as a pool of tappable cards and an ordered list built by tapping.
- WHEN a pool card is tapped, the system SHALL move it into the ordered list with its position number shown.
- WHEN the ✕ on an ordered item is activated, the system SHALL return that item to the pool and renumber the remainder.
- The system SHALL randomise pool card order per respondent.
- The system SHALL NOT use a drag-and-drop library or require a drag gesture to complete the question.
- The system SHALL provide explicit up/down controls as a keyboard-reachable alternative to tapping.
- On the same screen, the system SHALL also collect the delete-one radio and a second, initially collapsed, predicted-group-ranking control.
- The system SHALL persist the answer as `{ rank, delete, why, predicted }`.

### Acceptance

- [ ] The full question is completable with one thumb at 360px
- [ ] The full question is completable with keyboard only
- [ ] Pool order differs between two respondents on the same cohort
- [ ] Screen reader announces position changes

**Blocked on:** the fourth app's name (plan blocker 2). Build against a placeholder identifier in the registry; the name is content, not structure.

---

## F03-T08 — Paired rows with a starred selection (Q11)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `ui_ux.md` §4.10

### Requirements

- The system SHALL render three blocks, each with a "What" field and a "Done when" field.
- The system SHALL render the star as a radio across all three blocks, not a checkbox.
- WHEN a second star is selected, the system SHALL clear the first and show the inline note "Only one can be the most important — that's the point."
- The system SHALL require only the first block; blocks two and three SHALL be optional.
- The system SHALL persist the answer as `{ rocks: [{what, done_when}], starred }`.

### Acceptance

- [ ] Selecting a second star clears the first and surfaces the note
- [ ] Completing only block one passes the required check
- [ ] The note reads as a reason, not as a validation error

---

## F03-T09 — Capped multi-select, hours slider, and the private field (Q14)

**Phase:** P1 · **Depends:** F03-T01, F01-T03 · **Traces:** FR-10, FR-12, `ui_ux.md` §4.11, `anakloud-baseline-questions.md` Q14

### Requirements

- The system SHALL offer exactly these sixteen functions: product · backend · mobile/frontend · QA · design/UX · data privacy & security · clinical & regulatory liaison · sales & center partnerships · doctor relations · onboarding & customer success · support · marketing · finance & bookkeeping · fundraising · legal & IP · hiring.
- The system SHALL NOT visually distinguish, reorder, or emphasise any subset of those functions in the respondent UI.
- The system SHALL render function selection as chips with a maximum of three selections.
- WHEN three chips are selected, the system SHALL dim the remaining chips.
- IF a dimmed chip is tapped, THEN the system SHALL show "Pick at most 3 — swap one out." and SHALL NOT silently ignore the tap.
- The system SHALL render one short field per teammate, with names pre-filled from the cohort roster.
- The system SHALL render an hours slider from 0 to 60 with the current value shown large, and SHALL start it **unset** rather than at any default value.
- The system SHALL render Q14(d) as a visually distinct inset panel with a lock glyph and the copy from `ui_ux.md` §4.11(d).
- The system SHALL state on the field itself that only the facilitator sees it and that it appears in no comparison and no export.
- The system SHALL persist Q14(d) to its own `is_private = true` row (F01-T03).
- Q14(d) SHALL be optional, and the system SHALL say so on the field.

### Acceptance

- [ ] Tapping a dimmed chip produces the message, never a no-op
- [ ] The hours slider has no thumb position until the respondent sets one
- [ ] The private field's copy is present and matches `ui_ux.md` §4.11
- [ ] Q14(d) writes to `q14d`, not into the `q14` payload

---

## F03-T10 — Remaining input types (Q4, Q7, Q9, Q10, Q12)

**Phase:** P1 · **Depends:** F03-T01 · **Traces:** FR-10, `tech_infrastructure.md` §3.1, `anakloud-baseline-questions.md` Q4, Q7, Q9, Q10, Q12

### Requirements

- The system SHALL render Q4, Q7 and Q12 as short text with hard character caps of 140, 120 and 40 respectively, each with a visible live character counter.
- The system SHALL render Q9 as three separate labelled fields, all required, persisted as a three-item tuple.
- The system SHALL render Q10 as four parts: (a) payer as a single choice, (b) model as a single choice, (c) a peso amount whose unit follows from (b), and (d) a month-and-year picker.
- Q10(a) options SHALL be: center · parent · pediatrician/clinic · school · LGU/DOH · HMO · other.
- Q10(b) options SHALL be: monthly subscription per center · per-seat/per-therapist · per active child per month · per session fee · freemium with parent upgrade · commission on referrals · grant or institutional funding · not sure yet.
- The system SHALL treat "not sure yet" as a complete and valid answer to Q10(b) and SHALL NOT penalise it in validation or coaching.
- The system SHALL persist Q10 as `{ payer, model, amount, unit, first_peso }` with `first_peso` in `YYYY-MM`.
- The system SHALL render the month picker as a native-friendly control that works at 360px.
- The system SHALL NOT render placeholder text inside any of these fields.

### Acceptance

- [ ] Character caps are enforced at input, not only at validation
- [ ] Month picker produces `YYYY-MM` and is operable by keyboard
- [ ] Q9 persists as three distinct strings and all three are required
- [ ] Selecting "not sure yet" on Q10(b) passes validation and produces no nudge
- [ ] Q10(c)'s unit label follows the model chosen in (b)

**Note.** Q10's unit is derived from the model the respondent already picked, so it supplies nothing they haven't already said. This is why it is permitted here and forbidden on Q3 (F03-T04), where a unit list would be the anchor the question exists to avoid.

---

## F03-T11 — Confidence slider

**Phase:** P1 · **Depends:** F03-T01, F01-T07 · **Traces:** FR-11, `ui_ux.md` §4.3, §7

### Requirements

- The system SHALL render a 1–5 confidence slider on Q3, Q4, Q7, Q8, Q10 and Q11, and on no other question.
- The system SHALL require a confidence value on those six questions before continuing.
- The system SHALL pair the slider with a numeric input reflecting the same value.
- The system SHALL persist the value to `answers.confidence`.

### Acceptance

- [ ] The slider appears on exactly six questions, asserted against the registry
- [ ] Setting the numeric input moves the slider and vice versa
- [ ] Continue is refused, with an explanation, when confidence is unset on those six

---

## F03-T12 — Accessibility conformance

**Phase:** P1 · **Depends:** F03-T02 … F03-T11 · **Traces:** `ui_ux.md` §7

### Requirements

- The system SHALL make every interaction reachable and completable by keyboard alone.
- The system SHALL maintain a minimum contrast ratio of 4.5:1 throughout.
- The system SHALL provide touch targets of at least 44px.
- The system SHALL pair every slider with a numeric input.
- The system SHALL announce the coach card via `aria-live="polite"` so it does not interrupt typing.
- The system SHALL NOT convey the ink/pencil distinction by colour alone.

### Acceptance

- [ ] Automated axe pass on every question screen with zero serious or critical violations
- [ ] A keyboard-only run through all fifteen questions completes in E2E
- [ ] Contrast checked in both the questionnaire and the admin views
