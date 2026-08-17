# Align — Delivery Tracker

**Single source of truth for status.** Do not record status anywhere else — not in feature folders, not in commit messages, not in code comments.

**Last updated:** 2026-08-17 · **Current phase:** M · **Tickets:** 106 · **Done:** 97

---

## Update protocol

Follow this exactly. It is the contract between whoever is building and whoever is reading.

| When | Do this |
|---|---|
| **Starting a feature** | Set the feature row to `In progress` and fill in the **Started** date |
| **Starting a ticket** | Set the ticket row to `In progress` |
| **Ticket's acceptance criteria all pass and `./verify.sh` is green** | Set the ticket to `Done` |
| **Ticket blocked** | Set to `Blocked` and write the blocker in the **Notes** column — never leave a blocked ticket sitting at `In progress` |
| **All tickets in a feature are `Done`** | Set the feature row to `Done` and fill in the **Done** date |
| **Ticket abandoned** | Set to `Dropped` with a reason. Never delete the row and never reuse the ID |
| **Every update** | Update the **Last updated** date and the **Done** count at the top of this file |

Status values: `Not started` · `In progress` · `Blocked` · `In review` · `Done` · `Dropped`

A feature is not `Done` while any of its tickets is `Blocked` or `Dropped` without a replacement.

---

## Phase rollup

| Phase | Features | Gate to leave the phase |
|---|---|---|
| **P1 — Baseline** | F01 – F11 | F11-T02 (key-removal E2E) green, plus `spec.md` §10 criteria 1–6 |
| **P2 — Coach** | F12, F13 | F11-T04 (coach containment) green, plus criteria 7–10 |
| **P3 — Analysis** | F14 | Criteria 11–12 |
| **P4 — Official OPSP** | F15 | FR-39 conflict guard verified with no override path |
| **M — Neon + Gemini migration** | F16 – F20 | F20-T01 containment and key-removal gates green |

---

## Features

| # | Feature | Phase | Status | Started | Done | Notes |
|---|---|---|---|---|---|---|
| F01 | Foundation & data model | P1 | Done | 2026-08-16 | 2026-08-16 | |
| F02 | Invite, session & onboarding | P1 | Done | 2026-08-16 | 2026-08-16 | |
| F03 | Question engine & input types | P1 | Done | 2026-08-16 | 2026-08-17 | F03-T07 done against the placeholder app name (plan blocker 2) |
| F04 | Autosave, resume & offline | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F05 | Validators & coach shell | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F06 | Review, submit & lock | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F07 | Individual OPSP | P1 | Done | 2026-08-17 | 2026-08-17 | Unblocked — Part B mapping now available |
| F08 | Print & PDF export | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F09 | Admin gate & dashboard | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F10 | Comparison & divergence | P1 | Done | 2026-08-17 | 2026-08-17 | |
| F11 | Release gates & test harness | P1 | Done | 2026-08-17 | 2026-08-17 | **P1 gate** |
| F12 | AI gateway & degradation | P2 | Done | 2026-08-17 | 2026-08-17 | Do not start before F11 green |
| F13 | AI coach | P2 | Done | 2026-08-17 | 2026-08-17 | |
| F14 | Facilitator analysis | P3 | Done | 2026-08-17 | 2026-08-17 | |
| F15 | Official OPSP canvas | P4 | Done | 2026-08-17 | 2026-08-17 | |
| F16 | Gemini configuration guardrails | M | Done | 2026-08-17 | 2026-08-17 | M09–M11; do before the provider migration |
| F17 | Neon runtime | M | Not started | | | M01–M03 |
| F18 | Gemini provider | M | Not started | | | M06–M08; may proceed alongside F17 after F16 |
| F19 | Neon environments | M | Not started | | | M04–M05; follows F17 |
| F20 | Migration release gate | M | Not started | | | M12; final migration gate |

---

## F01 — Foundation & data model

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F01-T01 | Project scaffold and verification pipeline | Done | |
| F01-T02 | Core schema migration | Done | |
| F01-T03 | Private-row separation for Q14(d) | Done | |
| F01-T04 | Access policy and row-level security | Done | |
| F01-T05 | Seed script | Done | |
| F01-T06 | Environment config and level pinning | Done | |
| F01-T07 | Question registry | Done | |

## F02 — Invite, session & onboarding

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F02-T01 | Invite token issue and revocation | Done | |
| F02-T02 | Session claim | Done | |
| F02-T03 | Resume code | Done | |
| F02-T04 | Welcome and name entry | Done | |
| F02-T05 | Ground rules gate | Done | |
| F02-T06 | Session middleware and role resolution | Done | |

## F03 — Question engine & input types

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F03-T01 | Question shell and navigation | Done | |
| F03-T02 | Long text (Q1, Q13, Q15) | Done | |
| F03-T03 | Sentence completion (Q2) | Done | |
| F03-T04 | Metric triple (Q3) | Done | |
| F03-T05 | Matrix grid with mobile pivot (Q5) | Done | |
| F03-T06 | Single choice with required reason (Q6) | Done | |
| F03-T07 | Tap-to-assign ranking (Q8) | Done | |
| F03-T08 | Paired rows with a star (Q11) | Done | |
| F03-T09 | Capped multi-select, hours, private field (Q14) | Done | |
| F03-T10 | Remaining input types (Q4, Q7, Q9, Q10, Q12) | Done | |
| F03-T11 | Confidence slider | Done | |
| F03-T12 | Accessibility conformance | Done | |

## F04 — Autosave, resume & offline

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F04-T01 | Answer persistence API | Done | |
| F04-T02 | Debounced autosave and persistent save state | Done | |
| F04-T03 | Local mirror and offline mode | Done | |
| F04-T04 | Sync conflict resolution | Done | |
| F04-T05 | Resume landing | Done | |

## F05 — Validators & coach shell

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F05-T01 | Deterministic validators | Done | |
| F05-T02 | Static hints and examples | Done | |
| F05-T03 | Validation endpoint | Done | |
| F05-T04 | Coach card and nudge state machine | Done | |
| F05-T05 | Interaction logging | Done | |
| F05-T06 | L3 plain-form mode | Done | |

## F06 — Review, submit & lock

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F06-T01 | Review screen | Done | |
| F06-T02 | Submit confirmation | Done | |
| F06-T03 | Submit, snapshot and OPSP generation | Done | |
| F06-T04 | Lock enforcement | Done | |
| F06-T05 | Facilitator unlock with audit | Done | |
| F06-T06 | Submitted read-only view | Done | |

## F07 — Individual OPSP

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F07-T01 | Deterministic OPSP mapping | Done | 16 cells per Part B; 3-Year Targets needs a split mark |
| F07-T02 | OPSP view and draft labelling | Done | |
| F07-T03 | Ink, pencil and empty cells | Done | |
| F07-T04 | "How to read this" panel | Done | |
| F07-T05 | OPSP editing and versioning | Done | |

## F08 — Print & PDF export

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F08-T01 | Print stylesheet | Done | |
| F08-T02 | Print route and client save-as-PDF | Done | |
| F08-T03 | Server-side PDF rendering | Done | |
| F08-T04 | Private exclusion in export paths | Done | PDF/print sheet loaded via listPublicAnswers (AC1/AC2/AC3) |

## F09 — Admin gate & dashboard

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F09-T01 | Admin gate | Done | |
| F09-T02 | Admin-locked UI state | Done | |
| F09-T03 | Roster dashboard | Done | |
| F09-T04 | Level and budget header strip | Done | Strip built in P1 with the deterministic level; F12 populates live budget, circuit and guard data |
| F09-T05 | Cohort lifecycle | Done | |

## F10 — Comparison & divergence

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F10-T01 | Divergence scoring library | Done | |
| F10-T02 | Comparison data endpoint | Done | |
| F10-T03 | Comparison screen | Done | |
| F10-T04 | Anonymised and attributed modes | Done | |
| F10-T05 | CSV export | Done | |
| F10-T06 | Projection sheet export | Done | |

## F11 — Release gates & test harness

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F11-T01 | Verification script and npm scripts | Done | |
| F11-T02 | T2 key-removal E2E | Done | **P1 gate** |
| F11-T03 | T3 lock integrity property test | Done | |
| F11-T04 | T1 coach containment harness | Done | Offline half in the unit suite; `npm run test:coach-containment` gates P2 release |
| F11-T05 | Client bundle key check | Done | Build-time scan of `.next/static` for the AI key; wired into `npm run build` |
| F11-T06 | Log redaction test | Done | No answer/code/token/cookie in any log; AI calls logged as five-field records |

## F12 — AI gateway & degradation

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F12-T01 | Gateway module | Done | |
| F12-T02 | Level selection | Done | |
| F12-T03 | Circuit breaker | Done | |
| F12-T04 | Budget accounting | Done | |
| F12-T05 | Timeout and retry policy | Done | |
| F12-T06 | Interaction logging and token capture | Done | |
| F12-T07 | Facilitator budget and guard-trip surfacing | Done | |

## F13 — AI coach

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F13-T01 | Coach prompt and structured output | Done | |
| F13-T02 | Payload minimisation | Done | |
| F13-T03 | Output guard | Done | |
| F13-T04 | Coach endpoint resilience | Done | |
| F13-T05 | Examples on request only | Done | |
| F13-T06 | Contamination audit | Done | |

## F14 — Facilitator analysis

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F14-T01 | Analysis prompt and payload | Done | |
| F14-T02 | Analysis endpoint with degradation | Done | |
| F14-T03 | Analysis side panel | Done | |
| F14-T04 | Individual OPSP strengths and gaps | Done | |
| F14-T05 | Anonymised projection hardening | Done | |
| F14-T06 | Output labelling and re-run | Done | |

## F15 — Official OPSP canvas

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F15-T01 | Official OPSP canvas | Done | |
| F15-T02 | Source cards | Done | |
| F15-T03 | Compatibility classification | Done | |
| F15-T04 | Synthesis with the conflict guard | Done | |
| F15-T05 | Conflict result state | Done | |
| F15-T06 | Cell provenance | Done | |
| F15-T07 | Versioning and export | Done | |

---

## F16 — Gemini configuration guardrails

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F16-T01 | Reject moving Gemini model aliases | Done | M09 |
| F16-T02 | Retarget the client-bundle key guard | Done | M10 | Scans GEMINI + legacy ANTHROPIC names and values |
| F16-T03 | Rename the provider credential | Done | M11; retargets the T2 gate |

## F17 — Neon runtime

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F17-T01 | Separate pooled and direct connections | Not started | M01; migrations require the direct endpoint |
| F17-T02 | Use the Neon serverless driver behind the database boundary | Not started | M02 |
| F17-T03 | Guarantee connection release | Not started | M03 |

## F18 — Gemini provider

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F18-T01 | Implement the Gemini provider | Not started | M06 |
| F18-T02 | Preserve structured-output schema fidelity | Not started | M07 |
| F18-T03 | Handle Gemini safety blocks | Not started | M08; synthetic private-risk fixtures only |

## F19 — Neon environments

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F19-T01 | Use Neon branches for preview and hosted E2E | Not started | M04 |
| F19-T02 | Document the migration environment | Not started | M05 |

## F20 — Migration release gate

| ID | Ticket | Status | Notes |
|---|---|---|---|
| F20-T01 | Re-run the coach containment gate on Gemini | Not started | M12; **migration gate** |

## Open blockers

| # | Blocker | Blocks | Owner | Status |
|---|---|---|---|---|
| 1 | Part B OPSP mapping table | F07-T01 | Facilitator | **Resolved** 2026-08-16 |
| 2 | Fourth app has no name | F03-T07 content, F10 fixtures | Facilitator | Open |
| 3 | Confirm multi-cohort scope before F01-T02 lands | F01-T02 | Facilitator | Open |
| 4 | Confirm the facilitator answers as a respondent | F09-T01 | Facilitator | Open |
| 5 | Divergence thresholds have no numeric defaults | F10-T01 | Facilitator | Open — pick defaults, tune after real data |
| 6 | Product name — keep "Align" out of identifiers | Naming only | Facilitator | Open |

None of the open blockers stops work starting. Blocker 2 affects Q8 content only, so F03-T07 can be built against a placeholder identifier in the registry. Blocker 5 is resolved by choosing defaults in config and saying so.

## Runtime failure log

Autonomous runs write halt reasons to [`BLOCKED.md`](../BLOCKED.md) at the repository root. That file is the loop's output; this file remains the plan of record. When a `BLOCKED.md` entry is resolved, set the ticket back to `Not started` here and clear the entry there.
