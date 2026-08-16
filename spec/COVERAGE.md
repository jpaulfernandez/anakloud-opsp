# Coverage & traceability

Every numbered requirement in the source docs, mapped to the ticket that implements it. Anything unmapped is listed at the bottom with a reason.

## Question content (`anakloud-baseline-questions.md` Part A)

| Q | Type | Confidence | Coached | Ticket |
|---|---|---|---|---|
| Q1 | Long text, min 200 chars | — | No | F03-T02 |
| Q2 | Sentence completion, two blanks | — | No | F03-T03 |
| Q3 | Metric + number + unit + why | ⓘ | Yes | F03-T04 |
| Q4 | Short text, 140 cap | ⓘ | Yes | F03-T10 |
| Q5 | 9×4 role grid | — | No | F03-T05 |
| Q6 | Single choice + required reason | — | Yes | F03-T06 |
| Q7 | Short text, 120 cap | ⓘ | Yes | F03-T10 |
| Q8 | Ranking + delete radio + predicted ranking | ⓘ | No | F03-T07 |
| Q9 | Three required short texts | — | Yes | F03-T10 |
| Q10 | Choice + choice + amount + month | ⓘ | Yes | F03-T10 |
| Q11 | Three what/done-when pairs + star | ⓘ | Yes | F03-T08 |
| Q12 | Short text, 40 cap | — | No | F03-T10 |
| Q13 | Long text + single choice | — | No | F03-T02 |
| Q14 | Multi-select ≤3 + per-person + hours + private | — | No | F03-T09 |
| Q15 | Long text, optional | — | No | F03-T02 |

## OPSP cells (`anakloud-baseline-questions.md` Part B)

All sixteen cells and their default marks are specified in F07-T01. Part B's deliberate omissions — Profit/X targets, per-person KPIs, the full 7 Strata, cash conversion cycle — are not generated.

## Functional requirements (`spec.md` §5)

| FR | Requirement | Tickets |
|---|---|---|
| FR-1 | Unique invite link | F02-T01 |
| FR-2 | Display name, optional email | F02-T04 |
| FR-3 | No passwords; link is the credential | F02-T01, F02-T02 |
| FR-4 | Resume code | F02-T03 |
| FR-5 | Intro states the ground rules | F02-T05 |
| FR-6 | One question per screen | F03-T01 |
| FR-7 | Autosave, visible save state | F04-T01, F04-T02 |
| FR-8 | Pause/resume, return to first unanswered | F03-T01, F04-T05 |
| FR-9 | Backward nav; forward skip only when optional | F03-T01 |
| FR-10 | Twelve question types | F03-T02 … F03-T10 |
| FR-11 | Confidence on Q3,4,7,8,10,11 | F01-T07, F03-T11 |
| FR-12 | Q14(d) private field | F01-T03, F03-T09, F08-T04 |
| FR-13 | Review screen | F06-T01 |
| FR-14 | Submit locks; facilitator unlock logged | F06-T02 … F06-T05 |
| FR-15 | Taglish welcomed, no language validation | F02-T04, F02-T05 |
| FR-16 | Coach evaluates on advance | F05-T04 |
| FR-17 | Max 3 nudges | F05-T04 |
| FR-18 | Three actions at every nudge | F05-T04, F13-T05 |
| FR-19 | Neutral-domain examples | F05-T02, F13-T05 |
| FR-20 | Coach interactions logged | F05-T05, F12-T06, F13-T06 |
| FR-21 | No coach on Q1,2,13,14,15 | F01-T07, F05-T04 |
| FR-22 | Deterministic individual OPSP | F06-T03, F07-T01 |
| FR-23 | "Your draft" label | F07-T02 |
| FR-24 | Pencil cells, nothing auto-filled | F07-T03 |
| FR-25 | "How to read this" | F07-T04 |
| FR-26 | OPSP editable, answers untouched | F07-T05 |
| FR-27 | PDF export | F08-T01, F08-T02, F08-T04 |
| FR-28 | Admin locked until facilitator submits | F09-T01 |
| FR-29 | Cohort dashboard, no content | F09-T03 |
| FR-30 | Per-question comparison, two modes | F10-T03, F10-T04, F14-T05 |
| FR-31 | Deterministic divergence scoring | F10-T01 |
| FR-32 | AI alignment/conflict analysis | F14-T01, F14-T02, F14-T03 |
| FR-33 | Individual OPSP strengths/gaps | F14-T04 |
| FR-34 | Exports: CSV, PDFs, projection sheet | F10-T05, F10-T06, F08-T02 |
| FR-35 | Analysis labelled and re-runnable | F12-T06, F14-T03, F14-T06 |
| FR-36 | Official OPSP canvas | F15-T01 |
| FR-37 | Source cards | F15-T02 |
| FR-38 | AI synthesis | F15-T04 |
| FR-39 | Conflict guard | F15-T03, F15-T04, F15-T05 |
| FR-40 | Drafted cells require acceptance | F15-T04 |
| FR-41 | Cell-level provenance | F15-T06 |
| FR-42 | Version history and PDF | F15-T07 |

## Design principles (`spec.md` §3)

| PR | Principle | Where it is enforced |
|---|---|---|
| PR1 | Uninfluenced answers are the entire product | F03-T04 (no unit dropdown), F03-T07 (randomised pool), F03-T09 (no hours default), F09-T01 (admin gate), F13-T02, F13-T03, F13-T06 |
| PR2 | AI critiques form, never content | F13-T01, F13-T03 |
| PR3 | No AI on the critical path | F05-T01, F05-T03, F07-T01, F10-T01, F11-T02 |
| PR4 | Never block a submission | F05-T04, F13-T04 |
| PR5 | Original answers immutable after submit | F06-T04, F07-T05, F11-T03 |
| PR6 | Degradation must look intentional | F05-T06, F12-T05, F13-T04, F14-T03 |

## Product-specific tests (`tech_infrastructure.md` §8)

| Test | Ticket | Gates |
|---|---|---|
| T1 — coach containment | F11-T04 | P2 |
| T2 — key removal | F11-T02 | **P1** |
| T3 — lock integrity | F11-T03 | P1 |

## Acceptance criteria (`spec.md` §10)

| # | Criterion | Tickets |
|---|---|---|
| 1 | Answer on a phone, close, resume, lose nothing | F03-T01 … T12, F04-T01 … T05 |
| 2 | Submit locks; no respondent path alters answers | F06-T04, F11-T03 |
| 3 | OPSP from own answers, blanks left blank | F07-T01, F07-T03 |
| 4 | PDF renders, excludes private field | F08-T02, F08-T04 |
| 5 | Admin inaccessible until own submission locked | F09-T01 |
| 6 | Everything works with the key removed | F11-T02 |
| 7 | Hint within 6s or silent drop to L2 | F12-T05, F13-T04 |
| 8 | 30-answer adversarial test, no domain nouns | F11-T04, F13-T03 |
| 9 | "Submit as is" reachable at every nudge | F05-T04 |
| 10 | Every coach interaction in the audit log | F05-T05, F12-T06 |
| 11 | Divergence scoring runs with AI disabled | F10-T01 |
| 12 | Anonymised mode cannot be entered accidentally | F10-T04, F14-T05 |

## UI/UX coverage (`ui_ux.md`)

| Section | Tickets |
|---|---|
| §3 flows | F02-T04/T05, F04-T05, F09-T01 |
| §4.1 – §4.2 welcome, ground rules | F02-T04, F02-T05 |
| §4.3 question anatomy | F03-T01 |
| §4.4 – §4.11 input types | F03-T02 … F03-T10 |
| §4.12 – §4.13 review, submit | F06-T01, F06-T02 |
| §4.14 – §4.16 OPSP, editing, PDF | F07-T02 … T05, F08-T01/T02 |
| §4.17 – §4.19 admin | F09-T03, F09-T04, F10-T03, F10-T04, F14-T03 |
| §4.20 official canvas | F15-T01 … T06 |
| §5 coach interaction pattern | F05-T04, F13-T05 |
| §6 states | F04-T02/T03/T04, F06-T06, F09-T02, F09-T05 |
| §7 accessibility | F03-T12, plus per-input requirements |
| §8 microcopy | F02-T04/T05, F03-T08/T09, F06-T02, F07-T02/T03 |

## Deliberately not ticketed

| Item | Why |
|---|---|
| Transport encryption, encryption at rest (`spec.md` §8) | Platform configuration — provided by Vercel and managed Postgres, verified at deploy, not built |
| Data inventory listing (`spec.md` §8) | An organisational action for the facilitator, not software |
| Dark mode, multi-language toggle, realtime presence, comment threads, notifications, animated transitions, file uploads | Explicitly out of scope for P1 (`ui_ux.md` §9) |
| Naming the product | Open decision 1; keep "Align" out of identifiers so a rename stays a copy change |
| Who breaks ties in the session | Named as not a software decision (`spec.md` §11.4) |

## Reconciled conflicts between source docs

Where the docs disagreed, these tickets record the resolution. Do not "fix" them back.

| Conflict | Resolution | Ticket |
|---|---|---|
| `tech_infrastructure.md` §3.1 types Q13 as `{ text }`; the baseline doc adds a single-choice cause | Payload becomes `{ text, cause }` — the baseline doc wins on question content | F03-T02 |
| `spec.md` §7.1 requires all four Q10 parts and a future date; the baseline doc says "not sure yet" must not be penalised | "Not sure yet" short-circuits the Q10 validator | F05-T01, F03-T10 |
| Q3 forbids a unit dropdown; Q10(c) specifies one | Both stand — Q10's unit derives from the model the respondent already chose, so it supplies nothing new; Q3's would supply the measurement vocabulary | F03-T04, F03-T10 |
| The baseline doc bolds six functions in Q14 as the ones teams never volunteer for | That is facilitator commentary; the respondent UI shows all sixteen with no emphasis | F03-T09 |
| Baseline doc header says "13 questions" and cites Q11–Q13 as cuttable; body numbers Q1–Q15 and Part D cuts Q15/Q4/Q2/Q9 | Q1–Q15 is authoritative — it matches `spec.md` and `tech_infrastructure.md` | F01-T07 |
| Baseline doc's opening notes cite "Q5" for app ranking, "Q8/Q9" for rocks and theme | Stale numbering from an earlier draft; ranking is Q8, rocks Q11, theme Q12 | F01-T07 |

## Known gaps in the source docs

| Gap | Impact |
|---|---|
| The fourth app is unnamed | Blocks Q8 content (F03-T07) and the divergence fixtures. The baseline doc flags this itself and notes that leaving it blank biases the ranking |
| Divergence thresholds are described as "defaults in `tech_infrastructure.md`" but no numeric defaults appear there, and Part C defines the three bands qualitatively only | F10-T01 must choose defaults and record them in config; flag them for the facilitator to tune after seeing real data |
| Q10(c)'s peso unit list "matching (b)" is not enumerated | F03-T10 must derive it from the eight model options; straightforward but worth confirming |
