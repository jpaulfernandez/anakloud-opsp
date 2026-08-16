# F02 — Tickets

---

## F02-T01 — Invite token issue and revocation

**Phase:** P1 · **Depends:** F01-T02 · **Traces:** FR-1, FR-3, `tech_infrastructure.md` §9

### Requirements

- WHEN the facilitator adds a respondent to a cohort, the system SHALL generate an `invite_token` of 32 random bytes encoded base64url.
- The system SHALL scope every invite token to exactly one cohort and one respondent.
- WHEN the facilitator revokes a respondent's invite, the system SHALL reject all subsequent claims of that token.
- IF a token is presented that does not exist, is revoked, or belongs to a closed cohort, THEN the system SHALL return a neutral "this link isn't valid any more" screen and SHALL NOT disclose which of the three applies.
- The system SHALL NOT log invite tokens.

### Acceptance

- [ ] Two respondents never share a token
- [ ] A revoked token fails to claim, and the failure page is identical to the unknown-token page
- [ ] Token values absent from application logs under grep

---

## F02-T02 — Session claim

**Phase:** P1 · **Depends:** F02-T01 · **Traces:** FR-3, `tech_infrastructure.md` §4, §9

### Requirements

- WHEN a valid invite token or resume code is POSTed to `/api/session/claim`, the system SHALL set an httpOnly, SameSite=Lax session cookie signed with `SESSION_SECRET`.
- The system SHALL exchange the invite token for a cookie on first use and SHALL keep the token valid for re-claim from another device.
- The system SHALL NOT expire a session while the cohort is open.
- WHEN the cohort status is `closed`, the system SHALL admit the session in read-only mode rather than refusing it.
- The system SHALL NOT place the invite token in any URL after the initial claim redirect.

### Acceptance

- [ ] Claiming redirects to a token-free URL
- [ ] The cookie is httpOnly and SameSite=Lax, asserted in an E2E test
- [ ] A session left open for the length of the cohort never expires mid-questionnaire

---

## F02-T03 — Resume code

**Phase:** P1 · **Depends:** F02-T02 · **Traces:** FR-4, `tech_infrastructure.md` §9

### Requirements

- WHEN a respondent's first answer is saved, the system SHALL generate a 6-character resume code from an alphabet excluding `O`, `0`, `I` and `1`.
- The system SHALL display the resume code after the first save.
- WHERE the respondent supplied an email address, the system SHALL also email the code.
- IF more than 5 resume-code attempts originate from one IP within one hour, THEN the system SHALL reject further attempts for the remainder of the hour.
- The system SHALL treat resume-code entry as case-insensitive.

### Acceptance

- [ ] Generated codes contain no ambiguous characters
- [ ] The 6th attempt within an hour is rejected
- [ ] Lower-case entry of an upper-case code succeeds
- [ ] Email send failure does not block the questionnaire

---

## F02-T04 — Welcome and name entry

**Phase:** P1 · **Depends:** F02-T02 · **Traces:** FR-2, `ui_ux.md` §4.1

### Requirements

- WHEN a respondent claims an invite for the first time, the system SHALL present a single large name field with an optional secondary email field.
- The system SHALL require a display name before proceeding.
- The system SHALL state, next to the email field, that it exists only to resend a lost link.
- The system SHALL render the "Before we start" copy from `ui_ux.md` §4.1 verbatim.
- The system SHALL NOT validate the language, script or spelling of the display name.

### Acceptance

- [ ] Continue is unavailable with an empty name
- [ ] Email left blank completes the flow
- [ ] Copy matches `ui_ux.md` §4.1 word for word

---

## F02-T05 — Ground rules gate

**Phase:** P1 · **Depends:** F02-T04 · **Traces:** FR-5, FR-15, `ui_ux.md` §4.2, D6

### Requirements

- WHEN name entry completes, the system SHALL present the ground-rules screen with the four points from `ui_ux.md` §4.2 and an acknowledgement checkbox.
- The system SHALL state before any question: this is a baseline not a decision, answers are compared side by side, disagreement is expected, and one field is facilitator-only.
- The system SHALL state that Taglish is welcome.
- IF a respondent navigates directly to a question URL without having acknowledged the ground rules, THEN the system SHALL redirect to the ground-rules screen.
- The system SHALL record the acknowledgement so it is shown once, not on every resume.

### Acceptance

- [ ] Direct navigation to `/q/7` before acknowledgement redirects
- [ ] Acknowledgement persists across sessions and devices
- [ ] Resuming does not re-show the screen

---

## F02-T06 — Session middleware and role resolution

**Phase:** P1 · **Depends:** F02-T02, F01-T04 · **Traces:** `spec.md` §4, `tech_infrastructure.md` §4

### Requirements

- The system SHALL resolve, on every request, the respondent identity, their cohort, their `is_facilitator` flag, and their `submitted_at` state.
- The system SHALL make this resolution the single source of authorisation for all routes.
- IF no valid session cookie is present on a protected route, THEN the system SHALL respond 401 for API routes and redirect to the claim screen for page routes.
- The system SHALL NOT trust any role or identity value supplied by the client.

### Acceptance

- [ ] A forged cookie fails signature verification and yields 401
- [ ] `is_facilitator` cannot be set from a request header, body or query parameter
- [ ] Every API route in `tech_infrastructure.md` §4 passes through this middleware
