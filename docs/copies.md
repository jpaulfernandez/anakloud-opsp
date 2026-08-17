# Align — Copy Guide

**Version:** 0.1  
**Date:** 17 August 2026  
**Related docs:** `ui_ux.md` §8, `spec.md` §3 PR1/PR4/PR6, `AGENTS.md` "Copy is code here"

---

## Why this document exists

Copy in this tool is load-bearing. It is not decoration, and it is not an afterthought. This questionnaire asks six people to write down that they might leave, or that a co-founder's product should be killed. Every word on screen either earns an honest answer or loses one. This guide pins down the voice so nobody rewrites a carefully worded line into corporate sludge during a late-night commit.

---

## General rules

### 1. Write like a person talking to someone they respect

The reader is a founder. Talk to them the way a co-founder would — direct, a little informal, zero ceremony. If a sentence would sound weird said out loud across a table, rewrite it.

**Do:**
> Submitting locks your answers.

**Don't:**
> Thank you for completing the questionnaire. Your responses have been successfully submitted and locked.

### 2. Constraints are reasons, never rules

When the app limits something, say *why*. A constraint explained feels like a decision. A constraint unexplained feels like a bug.

**Do:**
> Only one can be the most important — that's the point.

**Don't:**
> Only one selection allowed.

**Do:**
> You won't be able to change them afterwards — that's deliberate, so the baseline stays a baseline.

**Don't:**
> Warning: Submissions are final and cannot be modified.

### 3. Silence on success

When something works, shut up. No "Great answer!", no "Well done!", no "Your response has been recorded." The coach says nothing when an answer passes — the screen just advances. Praise cheapens the nudges.

### 4. Name the uncomfortable thing

People are about to disagree with each other in writing. Copy that pretends this is routine gets routine answers. Copy that names the discomfort — *"if your answer is different from everyone else's, that's the single most useful thing here"* — gets real ones.

### 5. Never sound like a survey platform

Banned phrases and patterns:

| Kill on sight | Why |
|---|---|
| "Thank you for your valuable feedback" | Survey-platform slop. This is not a feedback form. |
| "You're doing great!" | Patronising. Adults don't need gold stars. |
| "Question 7 of 15 — keep going!" | Cheerleading. The progress dots say enough. |
| "Please provide your response" | Nobody talks like this. |
| "Submit your answers" (standalone) | Too generic. Say what happens: "Submit and lock." |
| "Error: invalid input" | Not a conversation. Say what's wrong in words. |
| "Successfully saved" | "Saved" is enough. The adverb adds nothing. |
| "Are you sure?" | Patronising confirmation theatre. State the consequence instead. |
| "N/A" or "None" as labels | Use a real phrase or leave it blank. |
| "Click here" | Nobody says this in 2026. Use the verb: "View", "Edit", "Open". |

### 6. No placeholders in answer fields

A placeholder is a worked example. A worked example anchors. Every open-text field is empty, and any guidance sits as helper text *above* the field, never inside it. This is not a preference — it is a hard constraint (PR1).

The one exception: the hours slider's number input shows "—" when unset, because that signals "no value chosen" rather than zero.

### 7. Fallback copy looks designed

If the AI drops out, the respondent sees a clean form. No "AI unavailable", no red banners, no retry spinners. The facilitator sees the level and the reason. The respondent sees nothing different (PR6).

### 8. Copy is code

Where `ui_ux.md` gives exact wording, use it verbatim. Do not improve it, do not make it friendlier, do not add encouragement. The words were chosen for the psychological effect, not the reading level.

### 9. No emojis

No emojis in UI copy, code, comments, or commit messages unless the spec explicitly includes one. If the spec says `Analyse ✨`, use the sparkle. Otherwise keep the screen clean.

---

## Voice reference

| Attribute | This app | Not this app |
|---|---|---|
| **Register** | Casual-professional. Co-founder to co-founder. | Corporate-formal. Platform to user. |
| **Length** | Short. One sentence where one sentence works. | Padded. "We would like to inform you that…" |
| **Honesty** | Names consequences directly. | Hides behind euphemisms. |
| **Encouragement** | Absent. The work matters; the work speaks. | Constant. "Great job!", "Almost there!" |
| **Error handling** | Says what happened and what to do. | "An error has occurred. Please try again." |
| **Pronouns** | "You" and "we" (the team). Never "the user". | "The respondent", "one's submission". |
| **Contractions** | Always. "You'll", "won't", "that's". | Formal. "You will", "will not". |

---

## Screen-by-screen copy inventory

For each screen: what's there now, what to keep, what to change.

> **KEY**  
> ✓ Keep as is — matches spec and voice  
> ⚑ Revisit — tone or wording could be sharper  
> ✕ Change — violates a rule or reads wrong

---

### Landing page (`/`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Anakloud" | ✓ | |
| Heading | "Align" | ✓ | Product name, minimal |
| Subtitle | "Figure out where the six of you actually agree." | ✓ | Direct and informal |
| Tab: Start | "Start new" | ✓ | |
| Tab: Resume | "Resume" | ✓ | |
| Start heading | "Get started" | ✓ | Direct |
| Start helper | "Paste the link from your invite, or type the token." | ✓ | No jargon |
| Label | "Invite link or token" | ✓ | |
| Button | "Open my questionnaire" | ✓ | First-person action |
| Resume heading | "Been here before?" | ✓ | Natural |
| Resume helper | "Enter your 6-character resume code to pick up where you left off." | ✓ | |
| Error (bad token) | "That invite link or token wasn't found or has expired." | ✓ | Direct, says what happened |
| Error (generic) | "Something went wrong. Please try again." | ✓ | Direct error note |

---

### Resume landing (`/`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Questionnaire in progress" | ✓ | |
| Heading | "Welcome back, {name}." | ✓ | Verbatim `ui_ux.md §3.2` |
| Progress | "You're on question {n} of 15." | ✓ | |
| All-done variant | "You've answered every question." | ✓ | |
| Button | "Continue" | ✓ | |
| Button | "Review what I've answered" | ✓ | First-person, natural |
| Section head | "Answered so far" | ✓ | |
| Jump link | "Edit →" | ✓ | |

---

### Welcome (`/welcome`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Anakloud Alignment" | ✓ | |
| Heading | "Before we start." | ✓ | Verbatim §4.1 |
| Body | "This is a set of questions about Anakloud — where it's going, who it's for, what has to happen next. Everyone answers on their own, before we talk as a group." | ✓ | Verbatim §4.1. Do not rewrite. |
| Callout | "There are no right answers and this isn't a test. If your answer is different from everyone else's, that's the single most useful thing that can come out of this." | ✓ | Verbatim §4.1. This line is doing real psychological work. |
| Time note | "Takes about 25 minutes. You can stop anytime and come back — nothing gets lost." | ✓ | Verbatim §4.1 |
| Name label | "Your name" | ✓ | |
| Email label | "Email (optional)" | ✓ | |
| Email helper | "so we can resend your link if you lose it" | ✓ | Verbatim §4.1 — lowercase because it reads as a parenthetical |
| Button | "Continue" | ✓ | |

---

### Ground rules (`/ground-rules`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Ground Rules" | ✓ | |
| Heading | "How we do this." | ⚑ | Not from §4.2. The spec goes straight to the four points. This heading is fine but it's an addition — it's earning its place if it orients the reader. Keep it, but **don't make it fancier.** |
| Rule 1 | "This is a baseline, not a decision. Nothing you write here becomes policy. We're finding out what each of us actually thinks before we agree on anything." | ✓ | Verbatim §4.2 |
| Rule 2 | "Answer before you talk to anyone. If you and Ern discuss it first, we've lost the point." | ✓ | Verbatim §4.2 — the named example is deliberate |
| Rule 3 | "Your answers will be shown side by side with everyone else's, without names, when we meet." | ✓ | Verbatim §4.2 |
| Rule 4 | "One question at the end is private — only Paul sees it. It's marked clearly when you get there." | ✓ | Verbatim §4.2 |
| Taglish note | "Taglish is completely fine. Write it how you'd actually say it." | ✓ | Verbatim §4.2 |
| Checkbox | "Got it" | ✓ | Verbatim §4.2 — not "I agree", not "I understand". Terse. |
| Button | "Continue" | ✓ | |

---

### Question screen (`/q/[id]`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Section badge | "Section: {name}" | ✓ | Quiet, orienting |
| Progress | "{n} of 15" | ✓ | |
| Save: pending | "Saving…" | ✓ | |
| Save: done | "✓ Saved" | ✓ | Persistent, not a toast. Verbatim §4.3. |
| Save: offline | "Saved on this device — will sync when you're back online." | ✓ | Verbatim §6 |
| Save: locked | "Locked" | ✓ | |
| Nav: back | "← Back" | ✓ | |
| Nav: forward | "Continue" | ✓ | |
| Nav: last question | "Review your answers" | ✓ | |
| Nav: from review | "Back to review" | ✓ | |
| Blocked: generic | "Answer this before moving on." | ✓ | |
| Blocked: Q6 reason | "Add a line about why" | ✓ | Verbatim §4.9 — says what's missing, not "required field" |
| Blocked: confidence | "Let us know how confident you are, from 1 to 5, before moving on." | ✓ | |
| Lock conflict heading | "Locked — your answers were already submitted." | ✓ | |
| Lock conflict body | "What you typed here couldn't be saved, so it's kept visible below rather than lost." | ✓ | Honest, names the problem, shows the data |

---

### Coach card

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Icon | None (neutral clean layout) | ✓ | Conforms to AGENTS.md emoji rule |
| Hint text | Dynamic from `lib/static-hints.ts` | ✓ | Each hint is ≤25 words, no digits, stays on form not content |
| Button | "Let me revise" | ✓ | First-person, respondent's action |
| Button | "Show me an example" | ✓ | |
| Button | "Keep it as is →" | ✓ | Present from nudge 1. Verbatim §5.1 |
| Example header | "The shape, not a suggestion:" | ✓ | Sets the boundary. Verbatim §5.1 |
| Counter | "nudge {n} of 3" | ✓ | Honest ceiling. Lowercase is correct — it reads as metadata. |
| Closing line | "Fair enough — going with yours." | ✓ | Verbatim §5.2. Respectful exit. |

---

### Static hints (`lib/static-hints.ts`)

These are the deterministic coach messages. They must stay:
- ≤25 words
- Zero digits (a number in a hint is a suggested target)
- No mention of healthcare, education, software, or any app name
- Slightly informal, never congratulatory

| Question | Current hint | Verdict |
|---|---|---|
| Q1 | "Say more here — a few sentences showing why this matters to you. There's room for the full picture." | ✓ | |
| Q3 | "Name what you would count, then the number and the unit. Make it something you could look up next quarter." | ✓ | |
| Q4 | "One clear statement — a single sentence. Trim it to the core idea." | ✓ | |
| Q6 | "Go beyond that — the reason matters. Spell out why you chose this, in your own words." | ✓ | |
| Q7 | "One promise, not a list. Pick the single outcome this comes down to." | ✓ | |
| Q9 | "Give real detail for each of the three — enough to see the situation, not a one-word label." | ✓ | |
| Q10 | "All four parts are needed — who pays, the amount, and the month it starts. Fill each one." | ✓ | |
| Q11 | "Make the done when something you can point at — a number, a date, or a concrete result." | ✓ | |
| Q12 | "Too long — a short name says it. One clean phrase, easy to say aloud." | ✓ | Blunt in the right way. |
| Q14 | "Pick at most three, and a realistic weekly total. Everything else stays off the list." | ✓ | |

---

### Review (`/review`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Before you submit" | ✓ | |
| Heading | "Review your answers" | ✓ | |
| Body | "Everything below is what your answers add up to. Open any question to change it before you lock the baseline in." | ✓ | |
| Unanswered card | "Not answered yet." | ✓ | |
| Skipped heading | "You skipped these — that's allowed." | ✓ | Verbatim §4.12 |
| Skipped helper | "You can leave them as they are or open one to answer it later." | ✓ | |
| Skip action | "Answer →" | ✓ | |
| Edit link | "Edit" | ✓ | |
| Submit button | "Submit and lock" | ✓ | Says what it does |
| Private note header | "Only Paul sees this one." | ✓ | Verbatim §4.11(d) |

---

### Submit confirmation (modal)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Heading | "Submitting locks your answers." | ✓ | Verbatim §4.13 |
| Body | "You won't be able to change them afterwards — that's deliberate, so the baseline stays a baseline. You'll still be able to edit the OPSP that gets built from them." | ✓ | Verbatim §4.13 |
| Cancel | "Not yet" | ✓ | Verbatim §4.13 — not "Cancel", which is weaker |
| Confirm | "Submit and lock" | ✓ | Verbatim §4.13 |

---

### Submitted view (`/submitted`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Baseline Locked" | ✓ | |
| Heading | "You're all set, {name}." | ✓ | Warm without being gushy |
| Body | "Your answers are in and the baseline is locked. This is the finished version — you can read it back any time." | ✓ | |
| OPSP heading | "Your One-Page Strategic Plan" | ✓ | |
| OPSP button | "View your One-Page Strategic Plan" | ✓ | |
| PDF note | "A printable PDF version will be here to view whenever you come back." | ✓ | Forward-looking, reassuring |
| Section | "Submitted Answers" | ✓ | |

---

### OPSP view (`/opsp`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "One-Page Strategic Plan" | ✓ | |
| Heading | "Your draft. Not the company's plan." | ✓ | Verbatim §4.14. Critical framing. |
| Body | "This is what your answers add up to. Everyone gets a different one. We'll build the real one together." | ✓ | Verbatim §4.14 |
| Edit bar note | "Editing this doesn't change your survey answers — those stay as you submitted them." | ✓ | Verbatim §4.15 |
| Print label | "Your draft — not the company's plan" | ✓ | Verbatim §4.16 |
| Cell: empty note | "You didn't answer this — that's fine, leave it blank." | ✓ | Verbatim §4.14 |
| Cell: pencil note | "You marked low confidence here — worth revisiting after beta." | ✓ | Verbatim §4.14 |
| Cell: revisit tag | "revisit" | ✓ | |
| How-to panel title | "How to read this" | ✓ | |
| How-to: Strong / Weak labels | "Strong:", "Weak:" | ✓ | |
| Cell action | "What's this?" | ✓ | Natural question |
| Edit controls | "Mark:", "Ink", "Pencil", "Cancel", "Save", "Saving…" | ✓ | |
| Export button | "Save as PDF" | ✓ | |

---

### Admin: locked (`/admin`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Heading | "Admin" | ✓ | |
| Body | "Finish your own answers first." | ✓ | Verbatim §6. A rule, not an error. |
| Link | "Resume your questionnaire" | ✓ | |

---

### Admin: dashboard (`/admin`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Badge | "Facilitator" | ✓ | |
| Heading | "Your cohort" | ✓ | |
| Canvas nav | "Official Team Plan" / "Official OPSP canvas →" | ✓ | |
| Export nav | "Session Presentation" / "Projection sheet →" | ✓ | |
| Compare section | "Compare answers" | ✓ | |
| Roster heading | "Team ({n})" | ✓ | |
| Roster columns | "Name", "Status", "Progress", "Last active", "Time spent" | ✓ | |
| Roster: empty | "No one has been invited to this cohort yet." | ✓ | |
| Status pills | "Not started", "In progress", "Submitted" | ✓ | |
| Unlock log | "Reopened by {name} · {timestamp}" | ✓ | Audit trail |
| Strip: level | "Level" | ✓ | |
| Strip: reason | "Running on rule-based checks." / "Running on rule-based checks — AI budget at {n}%." | ✓ | Verbatim §4.17 |
| Strip: budget labels | "Token budget", "Circuit", "Guard trips" | ✓ | Facilitator-facing technical labels are fine here |
| Budget alerts | "AI budget above 70% — watch usage." / "AI budget above 90% — nearly exhausted." | ✓ | |

---

### Admin: comparison (`/admin/question/[qid]`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Toggle | "Attributed" / "Anonymised" | ✓ | |
| Attribution warning | "This shows names. Don't use this while projecting." | ✓ | Verbatim §4.18 |
| Attribution modal | "Show names" / "Keep anonymised" | ✓ | |
| Shuffle note | "Order is randomised every load." | ✓ | |
| Empty state | "No one has answered this question yet." | ✓ | |
| Divergence badges | "Aligned", "Soft split", "Hard split" | ✓ | |
| Analyse button | "Analyse ✨" | ✓ | Matches `ui_ux.md` §4.18 verbatim |
| Analysis: prep label | "Prep material. Not a finding to show the team." | ✓ | Verbatim §4.19 |
| Analysis sections | "Where you agree", "Where you don't", "What to ask in the room" | ✓ | Verbatim §4.19 |

---

### Admin: official OPSP (`/admin/official-opsp`)

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Conflict message | "These two don't reconcile. Someone has to choose." | ✓ | Verbatim §4.20. No "merge anyway" — the absence of that button is the feature. |
| Source trigger | "+ Add someone's answer" | ✓ | Verbatim §4.20 |
| Print label | "Official One-Page Strategic Plan" | ✓ | |
| Decision log | "Record the decision" | ✓ | |

---

### Q14 private field

| Element | Current copy | Verdict | Notes |
|---|---|---|---|
| Heading | "Only Paul sees this one." | ✓ | Verbatim §4.11(d) |
| Body | "Not in any comparison, not in any export, not shown to the group." | ✓ | Verbatim §4.11(d) |
| Prompt | "Is there anything that would make you step back from this, that you haven't said out loud yet?" | ✓ | Verbatim §4.11(d) |
| Optional note | "leaving this blank is completely fine." | ✓ | Verbatim §4.11(d) — lowercase because it reads as a parenthetical |
| Cap message | "Pick at most 3 — swap one out." | ✓ | Verbatim §4.11(a) — reason, not a rule |
| Star note | "Only one can be the most important — that's the point." | ✓ | Verbatim §4.10 |

---

## Summary of recommended changes

| # | Location | Current | Proposed | Reason |
|---|---|---|---|---|
| 1 | `app/page.tsx:127` | "Anakloud strategic alignment questionnaire." | "Figure out where the six of you actually agree." | Reads like metadata, not like a person talking |
| 2 | `app/StartOrResumeForm.tsx:114` | "Start questionnaire" | "Get started" | Less formal, more direct |
| 3 | `app/StartOrResumeForm.tsx:117` | "Enter your invite link or personal token from your team." | "Paste the link from your invite, or type the token." | Drops jargon ("personal token") |
| 4 | `app/q/[id]/CoachCard.tsx:56` | 💡 emoji | Remove | Violates AGENTS.md emoji rule |
| 5 | `lib/static-hints.ts:50` | "Provide more detail here" | "Say more here" | "Provide" is stiff |
| 6 | `app/admin/page.tsx:160` | "Admin Dashboard" | "Your cohort" | Less generic, more grounded |
| 7 | `app/admin/page.tsx:290` | "Cohort Roster ({n})" | "Team ({n})" | Less clinical |
| 8 | `app/admin/question/[qid]` | "Analyse" | "Analyse ✨" | Match `ui_ux.md` §4.18 verbatim |

---

## Do not change

The following are exact-wording lines from `ui_ux.md` that are in the codebase verbatim and must not be edited, paraphrased, or "improved":

- "Before we start." (§4.1)
- "There are no right answers and this isn't a test." (§4.1)
- "This is a baseline, not a decision." (§4.2)
- "Answer before you talk to anyone." (§4.2)
- "Got it" (§4.2)
- "Taglish is completely fine. Write it how you'd actually say it." (§4.2)
- "Add a line about why" (§4.9)
- "Only one can be the most important — that's the point." (§4.10)
- "Pick at most 3 — swap one out." (§4.11)
- "Only Paul sees this one." (§4.11(d))
- "Keep it as is →" (§5.1)
- "Fair enough — going with yours." (§5.2)
- "You skipped these — that's allowed." (§4.12)
- "Submitting locks your answers." (§4.13)
- "Not yet" / "Submit and lock" (§4.13)
- "Your draft. Not the company's plan." (§4.14)
- "You didn't answer this — that's fine, leave it blank." (§4.14)
- "You marked low confidence here — worth revisiting after beta." (§4.14)
- "Editing this doesn't change your survey answers — those stay as you submitted them." (§4.15)
- "This shows names. Don't use this while projecting." (§4.18)
- "Prep material. Not a finding to show the team." (§4.19)
- "These two don't reconcile. Someone has to choose." (§4.20)
- "Finish your own answers first." (§6)
- "Saved on this device — will sync when you're back online." (§6)
