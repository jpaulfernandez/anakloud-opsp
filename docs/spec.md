# Align — Product Specification

**Working name:** Align (placeholder — rename before build)
**Owner:** Facilitator (Paul)
**Version:** 0.1 draft
**Date:** 16 August 2026
**Related docs:** `ui_ux.md`, `tech_infrastructure.md`, `anakloud-baseline-questions.md`

---

## 1. What this is

A private tool for a founding team to answer a strategy questionnaire independently, see their own draft One-Page Strategic Plan generated from their answers, and give the facilitator a comparison view that shows where the team agrees and where it doesn't.

First use: the Anakloud founding team, ~6 people, September 2026, ahead of the transition from capstone project to formal venture.

## 2. What it is not

- Not a survey platform. There is one questionnaire, one cohort, one facilitator.
- Not a decision-making tool. It produces a **baseline**, not a plan. The plan is made by humans in a room.
- Not an AI strategy consultant. See §6 — the AI's job is deliberately narrow and it is never allowed to supply content.

---

## 3. Design principles

These are load-bearing. When a later decision conflicts with one of these, the principle wins.

**PR1 — Uninfluenced answers are the entire product.**
The value of this exercise comes from six people answering without hearing each other first. Any feature that leaks one person's thinking into another person's answer destroys the thing being measured. This includes the AI.

**PR2 — The AI critiques form, never content.**
It may say an answer isn't measurable. It may never suggest what to measure. See §6.2 for the hard constraints.

**PR3 — No AI on the critical path.**
Every AI feature has a deterministic sibling that produces a usable result. If the API key is revoked mid-session, every user-facing function still completes. See §7.

**PR4 — Never block a submission.**
The coach nudges. It cannot gate. "Submit as is" is available from the first nudge onward. An answer someone insists on keeping is data about that person, and it belongs in the baseline.

**PR5 — Original answers are immutable after submit.**
The derived OPSP is editable. The raw answers are not. Otherwise people will quietly revise their answers toward whatever their generated OPSP made them feel, and the baseline stops being a baseline.

**PR6 — Degradation must look intentional.**
A user in fallback mode sees a clean form, not an error. They should not be able to tell that something broke.

---

## 4. Roles

| Role | Who | Can |
|---|---|---|
| **Respondent** | Each founding team member | Answer the questionnaire, pause/resume, view and edit their own OPSP, export their own PDF |
| **Facilitator** | Paul | Everything a respondent can, plus: cohort setup, view all responses, anonymised comparison mode, AI analysis, official OPSP authoring |
| **Facilitator-as-respondent** | Paul, in phase 1 | Must complete and lock his own responses **before** the admin view unlocks. See §5.4 |

There is no public signup. Access is by tokenised invite link only.

---

## 5. Functional requirements

### 5.1 Entry and identity

- **FR-1** Respondent arrives via a unique, unguessable invite link (one per person, issued by the facilitator).
- **FR-2** On first visit, the respondent confirms or types their **display name**. Name is required; email is optional and only used to re-send a lost link.
- **FR-3** No passwords. The link *is* the credential. Links are single-cohort and revocable.
- **FR-4** A **resume code** (6 characters, human-readable) is shown after the first save and is also emailed if an address was given. Either the link or the code restores the session.
- **FR-5** The intro screen states, in plain language and before any question: this is a baseline not a decision, disagreement is expected, answers will be compared side by side, and one field is facilitator-only.

### 5.2 Answering

- **FR-6** One question per screen. No visible list of upcoming questions that would let someone plan a coherent narrative across answers.
- **FR-7** Answers autosave on change (debounced) and on navigation. Save state is always visible.
- **FR-8** Full pause/resume. Closing the tab loses nothing. Resuming returns the respondent to the first unanswered question, with the option to jump back to any answered one.
- **FR-9** Backward navigation is allowed within an unsubmitted session. Forward skipping is allowed for optional questions only.
- **FR-10** Question types required (details in `ui_ux.md` §4): long text, sentence completion, metric triple (name + number + unit), short text with hard character cap, matrix grid with checkboxes, ranking of 4 items, single choice with required free-text reason, repeating paired rows with a starred selection, numeric slider, capped multi-select, confidence slider (1–5), month picker.
- **FR-11** Confidence sliders appear on Q3, Q4, Q7, Q8, Q10, Q11 only. They are required.
- **FR-12** Q14(d) is a **private field**. Visible to the facilitator only, excluded from every comparison view, every export, and never transmitted to any AI provider. This is stated to the respondent on the field itself.
- **FR-13** A review screen before submit shows every answer with edit links.
- **FR-14** On submit, answers are **locked**. The respondent sees a clear warning before confirming. Only the facilitator can unlock, and unlocking is logged.
- **FR-15** Taglish input is explicitly welcomed in the intro copy. No language validation anywhere.

### 5.3 The answer coach

Full behavioural contract in §6.

- **FR-16** The coach evaluates an answer when the respondent tries to advance from a **coachable** question (§6.3).
- **FR-17** Maximum **3 nudges per question**, then it steps aside permanently for that question.
- **FR-18** Each nudge offers three actions: revise, show me an example, or submit as is. All three are available at every nudge including the first.
- **FR-19** Examples are drawn from a **neutral domain** (never healthcare, therapy, clinics, education, or software). They demonstrate the shape of a good answer, not its substance.
- **FR-20** Every coach interaction is logged — question, attempt number, verdict, hint text, whether an example was requested, and whether the answer changed afterwards. This exists so the facilitator can audit whether coaching pushed answers toward each other.
- **FR-21** The coach never runs on Q1, Q2, Q13, Q14, or Q15.

### 5.4 Individual OPSP

- **FR-22** After submitting, the respondent sees **their own** OPSP, generated deterministically by mapping their answers to OPSP cells (mapping table in the baseline questions doc, Part B). No AI is involved in generating it.
- **FR-23** The OPSP is labelled, prominently and unavoidably: **"Your draft — not the company's plan."**
- **FR-24** Cells the respondent left blank or answered with low confidence render as **pencil** — visually distinct, marked "revisit after beta". Nothing is auto-filled or invented.
- **FR-25** A **"How to read this"** panel accompanies the OPSP: one short explanation per cell, what it's for, and what makes it good or weak. Static content, written once, no AI.
- **FR-26** The respondent can edit their OPSP cells freely. Edits create a new version of the OPSP draft and **do not** alter the underlying answers (PR5).
- **FR-27** Export to PDF. Contains the OPSP, the ink/pencil markings, a timestamp, the respondent's name, and the "your draft" label. Excludes the private field.
- **FR-28** The facilitator's admin view stays locked until his own responses are submitted. Enforced in code, not by convention.

### 5.5 Facilitator view

- **FR-29** Cohort dashboard: who's been invited, who's started, who's finished, time spent, last activity. No answer content on this screen.
- **FR-30** **Per-question comparison**: all answers to one question side by side. Two modes:
  - *Attributed* — names shown. For preparing 1:1s.
  - *Anonymised* — names hidden, order randomised per view. For projecting during the session.
  - Mode is a deliberate toggle with a confirmation, so nobody projects the attributed view by accident.
- **FR-31** **Deterministic divergence scoring** for every question, computed without AI:
  - Closed questions (choice, ranking, matrix, numeric): exact agreement rate, modal answer, spread.
  - Confidence-bearing questions: classified **aligned / soft split / hard split** using answer spread × mean confidence. Thresholds configurable, defaults in `tech_infrastructure.md`.
  - Open text: flagged for manual review, with word-count and length spread shown.
- **FR-32** **AI analysis** (optional layer on top of FR-31): for a selected question or for the cohort, produce a structured read — points of agreement, points of conflict with the conflicting positions stated fairly, and questions the facilitator should ask in the session. Output is always presented as *the facilitator's prep material*, never as a finding to show the team without review.
- **FR-33** **Individual OPSP analysis**: for one respondent's OPSP, an AI-generated strengths/gaps read — which cells are internally consistent, which contradict each other, which are unfalsifiable. Facilitator-only.
- **FR-34** Export everything: CSV of all answers (private field excluded unless explicitly re-confirmed), per-respondent PDFs, and a projection-ready comparison sheet.
- **FR-35** All AI analysis outputs are labelled with the model used and a timestamp, and are re-runnable.

### 5.6 Official OPSP (Phase 3)

- **FR-36** A collaborative OPSP canvas the team fills in during or after the alignment session.
- **FR-37** Per cell, the facilitator can pull in any respondent's answer as a **source card** — e.g. "add Ern's point here" attaches Ern's Q7 answer to the Brand Promise cell.
- **FR-38** With 2+ source cards on a cell, an AI **synthesis** action drafts a single statement.
- **FR-39** **Conflict guard, non-negotiable:** if the source cards materially disagree, the AI must refuse to synthesise. It returns the conflict, states both positions, and requires a human decision. It may never average two incompatible positions into a sentence that hides the disagreement. This enforces "decide, don't average" in software rather than leaving it to discipline in the room.
- **FR-40** Every AI-drafted cell is marked as a draft and requires explicit human acceptance before it enters the official OPSP.
- **FR-41** Cell-level provenance: the official OPSP records which respondents' answers fed each cell.
- **FR-42** Version history with named snapshots (e.g. "Q4 2026 v1") and PDF export.

---

## 6. The AI contract

### 6.1 Why this section exists

You asked for an AI that helps people expound without influencing them. Those two goals are in genuine tension — a model that offers an example of a good answer *is* an influence, and if all six respondents see the same example, you have manufactured the consensus the whole exercise was designed to detect.

The resolution is a strict split: **the AI may operate on the form of an answer and is forbidden from the substance.** Everything below implements that.

### 6.2 Hard constraints

The coach:

- **MAY** state that an answer is not measurable, is ambiguous, contains multiple answers where one was asked for, or is too short to interpret.
- **MAY** ask a neutral opening question: *"What would you point at to show this happened?"*
- **MAY**, only on request, give one example from a **neutral domain** — a bakery, a gym, a delivery business. Never healthcare, therapy, clinics, schools, or software.
- **MUST NOT** suggest a metric, a customer segment, a number, a business model, a priority, a risk, or a value.
- **MUST NOT** reference any other respondent's answer, or any earlier answer by the same respondent. Each evaluation sees one answer and nothing else.
- **MUST NOT** state or imply an opinion about whether the answer is *correct*.
- **MUST NOT** exceed 25 words in a hint.
- **MUST NOT** run more than 3 times per question.
- **MUST NOT** ever prevent submission.

**Worked example.** Respondent writes, for Q3: *"A lot of kids getting help."*

- Allowed: *"That's a direction, not a number. What would you count to know it happened?"*
- Allowed, on request: *"Shape of a measurable answer, from a different industry: 'orders fulfilled same-day — 500 per week.' Metric, then value."*
- **Forbidden:** *"You could measure children with an active therapy plan."* — that supplies content and would seed the same unit into every respondent who asked for help.

### 6.3 Where the coach runs

| Question | Coached | Dimension checked |
|---|---|---|
| Q1 purpose | No | Wants raw voice |
| Q2 who notices | No | — |
| Q3 3-year metric | **Yes** | Measurability, single metric |
| Q4 BHAG | **Yes** | Length, single statement |
| Q5 role grid | No | Structurally constrained |
| Q6 tiebreak | **Yes** | Reason field non-empty and not circular |
| Q7 brand promise | **Yes** | Single promise, not a feature list |
| Q8 wedge ranking | No | Structurally constrained |
| Q9 not-doing | **Yes** | Specificity |
| Q10 money | **Yes** | Completeness of the four parts |
| Q11 rocks | **Yes** | Done-condition is verifiable |
| Q12 theme | No | Short by design |
| Q13 pre-mortem | No | Wants raw voice |
| Q14 ownership | No | Structurally constrained |
| Q15 values story | No | Wants raw voice |

### 6.4 Facilitator-side AI

Different job, looser constraints, because there is no contamination risk — the facilitator is the only reader and the answers are already locked.

- Alignment/conflict analysis (FR-32) and individual OPSP analysis (FR-33) may reason about content.
- Both must present conflicting positions **fairly and in the respondents' own words** where possible, rather than resolving them.
- Both are labelled facilitator prep. Neither is shown to the team without the facilitator explicitly choosing to.
- Synthesis (FR-38) is bound by the conflict guard (FR-39).

---

## 7. Degradation ladder

Four levels. The system self-selects based on health checks and budget state, and can be pinned manually by the facilitator.

| Level | Trigger | Coach behaviour | Facilitator analysis | User sees |
|---|---|---|---|---|
| **L0 — Full** | AI healthy, budget OK | Model-based hints and examples | Full AI analysis | Normal |
| **L1 — Degraded** | Latency > 6s, or rate-limited, or transient errors | Deterministic validators only (§7.1); no examples | AI analysis queued, retried in background | Slightly terser hints. No error shown |
| **L2 — Rule-based** | AI unavailable, credits exhausted, circuit breaker open | Deterministic validators + static pre-written hints | Deterministic divergence scoring (FR-31) + exports only | Same coaching feel, fixed hint text |
| **L3 — Plain form** | Manually pinned, or L2 validators disabled | None. Every answer accepted | Raw comparison tables + CSV | A clean questionnaire with no coach at all |

**The system never surfaces an AI error to a respondent.** It drops a level silently. The facilitator sees the current level and the reason on the admin dashboard.

### 7.1 Deterministic validators (available at L1, L2, L3-optional)

These cover most of what the coach is for, without a model. They are the reason credits running out is an inconvenience rather than a failure.

- **Q3** — metric name non-empty; value parses as a number; unit non-empty.
- **Q4** — non-empty, ≤140 chars, single sentence.
- **Q6** — reason non-empty, ≥8 words, not a restatement of the choice.
- **Q7** — non-empty, ≤120 chars, at most one conjunction (more than one suggests a feature list).
- **Q9** — all three fields non-empty, each ≥4 words.
- **Q10** — all four parts present; date is in the future.
- **Q11** — each done-condition contains a digit, a date, or a countable noun **and** does not consist solely of a vague verb from the blocklist (*improve, enhance, optimise, streamline, better, strengthen, level up, polish*).
- **Q12** — ≤40 chars, ≥2 words.
- **Q1** — ≥200 characters.
- **Q14** — at most 3 functions selected; hours between 0 and 60.

Each has a fixed hint string written in advance, matching the coach's tone. Static examples are pre-written for Q3, Q7 and Q11 in the same neutral-domain style.

### 7.2 Budget protection

- Hard token cap per cohort, per respondent, and per single request.
- A circuit breaker opens on repeated failures and on budget exhaustion, dropping to L2.
- Facilitator dashboard shows spend against cap, with a warning at 70% and again at 90%.
- The facilitator can pin L2 or L3 at any time — for example, to run the whole cohort cheaply and reserve budget for the analysis phase.

---

## 8. Data and privacy

- Founder responses are candid internal opinions about the business and each other. Treat them as confidential, not as ordinary form data.
- **Q14(d) never leaves the database in any form other than the facilitator's own screen.** Not in CSV exports, not in PDFs, not in any AI request, not in logs.
- All AI calls are server-side. No API key ever reaches the browser.
- AI requests carry the answer text and question metadata only — no names, no email addresses, no respondent IDs.
- Data retention: cohort data is deletable in full by the facilitator, one action.
- Transport encrypted; database encrypted at rest.
- This tool holds no patient data and is out of scope for the Anakloud clinical compliance work. It should still be listed in the company's data inventory when that inventory gets created, because it holds personal opinions of identifiable people.

---

## 9. Phasing

You need this working for a session next month. The full description above is several weeks of work. Ship in this order — each phase is independently useful.

| Phase | Contents | Rough effort | Ship by |
|---|---|---|---|
| **P1 — Baseline** | Invite links, name entry, all 15 questions, autosave, pause/resume, review, submit & lock, deterministic validators (L2), individual OPSP view, "how to read this", OPSP editing, PDF export, facilitator raw comparison + CSV | 4–6 dev-days | Early Sept 2026 |
| **P2 — Coach** | AI coach at L0/L1 with the §6.2 constraints, interaction logging, budget controls, circuit breaker | 2–3 dev-days | Mid Sept |
| **P3 — Analysis** | Divergence scoring UI, AI alignment/conflict analysis, individual OPSP strengths/gaps, anonymised projection mode | 3–4 dev-days | Before the session |
| **P4 — Official OPSP** | Collaborative canvas, source cards, AI synthesis with conflict guard, provenance, versioning | 5–7 dev-days | After the session, for Q1 2027 planning |

**P1 alone delivers the whole exercise.** If nothing else gets built, you can still run the session properly. Everything after P1 makes the facilitator's job easier, not the exercise possible.

**A cost worth naming honestly:** this is a substantial build for a six-person, one-time survey, and a Google Form plus a spreadsheet would get you to the session with a few hours of work. Reasons to build it anyway: your team is idle-ish between capstone and beta, it's low-risk practice on the stack you'll use for Anakloud, and P4 makes it reusable every quarter. Reasons not to: it's a month of attention that could go into beta onboarding, and beta is the thing with a deadline that matters. If P1 slips past the first week of September, run the session on a Google Form and keep building in parallel.

---

## 10. Acceptance criteria

**P1 ships when:**

1. Six people can each answer all 15 questions from a phone, close the browser mid-way, and resume with nothing lost.
2. Submitting locks the answers, and no respondent-facing path can alter them afterwards.
3. Each respondent sees an OPSP derived only from their own answers, with blanks left blank.
4. PDF export renders correctly and excludes the private field.
5. The facilitator's admin view is inaccessible until his own submission is locked.
6. With the AI provider's key removed entirely from the environment, every one of the above still works.

**P2 ships when:**

7. The coach produces a hint within 6 seconds or the system silently drops to L2.
8. In an adversarial test of 30 answers, the coach never supplies a domain-specific noun (see `tech_infrastructure.md` §8 for the automated check).
9. "Submit as is" is reachable at every nudge, verified by test.
10. Every coach interaction appears in the audit log with attempt number and outcome.

**P3 ships when:**

11. Divergence scoring runs with the AI fully disabled and still classifies every closed question.
12. Anonymised mode cannot be entered accidentally.

---

## 11. Open decisions

1. **Name.** "Align" is a placeholder. If this ever becomes a product for other teams, it needs a real one.
2. **Cohort scope.** Built for one cohort now. Multi-cohort is cheap if designed in at the data layer from the start — decide before P1, it's expensive to retrofit.
3. **Does the facilitator answer at all?** Recommended yes, and answering first is enforced in FR-28. Confirm you actually want to be a respondent.
4. **Who breaks ties** in the session (§ session agenda in the questions doc). Not a software decision, but the official OPSP needs a named decider before P4.
5. **Fourth app's name** — still needed for Q8. Blocking for P1 content.
