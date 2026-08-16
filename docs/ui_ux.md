# Align — UI/UX Specification

**Version:** 0.1 draft
**Date:** 16 August 2026
**Related docs:** `spec.md`, `tech_infrastructure.md`, `anakloud-baseline-questions.md`

---

## 1. Design principles

**D1 — One question, one screen.** No scrolling list of upcoming questions. Someone who can see all fifteen at once will compose a coherent narrative across them, and a coherent narrative is exactly what you don't want from a baseline.

**D2 — The coach sits beside the answer, never in front of it.** It appears below the field as a card. It never opens a modal, never disables the Continue button, never takes focus away from the textarea.

**D3 — Fallback must look designed.** L2 and L3 are not error states. No red banners, no "AI unavailable", no retry spinners. A respondent in L3 sees a clean questionnaire and has no reason to think anything is missing.

**D4 — Save state is always visible.** People will answer this on a phone, on mobile data, between other things. The single biggest trust failure would be losing an answer. Show the save state permanently, not as a toast that disappears.

**D5 — Phone first.** Assume most people answer on a phone, one-handed, possibly on a jeepney. Every interaction must work at 360px with thumb-reachable controls. The ranking question is the hard one — see §4.7.

**D6 — Honest microcopy.** This tool asks people to be candid about their co-founders and their own commitment. Copy that sounds like a corporate survey will get corporate answers. Copy is a feature here, not decoration. See §8.

---

## 2. Visual direction

Deliberately plain. This is an instrument, not a brand surface.

- **Type:** one sans-serif family, two weights. Question text large (20–24px mobile, 28px desktop), body 16px minimum. Long-form answers deserve generous line height (1.6).
- **Colour:** near-monochrome base. Exactly three accent uses — save state (subtle), coach card (a single neutral-warm tone, never yellow-warning or red-error), and the ink/pencil distinction in the OPSP.
- **Ink vs pencil:** ink = solid text, full contrast. Pencil = lighter weight, dashed left border, small "revisit" tag. This distinction carries meaning and must survive printing to black and white — use weight and border, not colour alone.
- **Density:** loose in the questionnaire (one thing to think about), tight in the admin comparison view (scanning many things at once).
- **Dark mode:** nice-to-have, not P1.

---

## 3. Flows

### 3.1 Respondent — first run

```
Invite link
  → Welcome / name entry
  → Ground rules (single screen, cannot be skipped, ~30s read)
  → Q1 … Q15  (autosave throughout; coach on coachable questions)
  → Review all answers
  → Submit confirmation (explicit warning that this locks)
  → Locked ✓
  → Your OPSP  (+ "How to read this" panel)
  → Edit OPSP (optional)
  → Export PDF
```

### 3.2 Respondent — resume

```
Invite link OR resume code
  → "Welcome back, {name}. You're on question 7 of 15."
  → [Continue]  [Review what I've answered]
  → back into the flow at the first unanswered question
```

Resume must never dump someone at Q1. Landing back at the start is the most common reason people abandon a half-finished form.

### 3.3 Facilitator

```
Own questionnaire (must be submitted & locked first)
  → Admin unlocks
  → Dashboard (progress only, no content)
  → Per-question comparison  [Attributed ⇄ Anonymised]
  → Divergence scoring
  → AI analysis (optional, per question or cohort)
  → Individual OPSP review + strengths/gaps
  → Exports: CSV · PDFs · projection sheet
  → [P4] Official OPSP canvas
```

---

## 4. Screens

### 4.1 Welcome / name entry

Single field, large. Name only; email is a secondary optional field with a one-line reason ("so we can resend your link if you lose it").

Below the fold: what this is, in three sentences, in the facilitator's voice not a product voice.

> **Before we start.**
> This is a set of questions about Anakloud — where it's going, who it's for, what has to happen next. Everyone answers on their own, before we talk as a group.
>
> **There are no right answers and this isn't a test.** If your answer is different from everyone else's, that's the single most useful thing that can come out of this.
>
> Takes about 25 minutes. You can stop anytime and come back — nothing gets lost.

### 4.2 Ground rules

One screen, four points, a checkbox to continue. Do not let this be skipped; it's what makes people answer honestly.

> - **This is a baseline, not a decision.** Nothing you write here becomes policy. We're finding out what each of us actually thinks before we agree on anything.
> - **Answer before you talk to anyone.** If you and Ern discuss it first, we've lost the point.
> - **Your answers will be shown side by side with everyone else's**, without names, when we meet.
> - **One question at the end is private** — only Paul sees it. It's marked clearly when you get there.
>
> Taglish is completely fine. Write it how you'd actually say it.

☐ Got it

### 4.3 Question screen — anatomy

```
┌──────────────────────────────────┐
│ ● ● ● ○ ○ ○ ○ ○ …      7 of 15   │  progress
│                                  │
│  Section: Focus                  │  quiet section label
│                                  │
│  Which door opens first?         │  question, large
│                                  │
│  Rank the four apps by which     │  helper text, regular weight
│  one gets a customer to say      │
│  yes first…                      │
│                                  │
│  ┌────────────────────────────┐  │
│  │  [ input, type-specific ]  │  │
│  └────────────────────────────┘  │
│                                  │
│  ┌ coach card (conditional) ──┐  │
│  └────────────────────────────┘  │
│                                  │
│  Confidence  1 ─○─────── 5       │  only on marked questions
│                                  │
│  ✓ Saved                [Continue]│
│  ← Back                          │
└──────────────────────────────────┘
```

**Rules:**

- No placeholder text inside any open-text field. Placeholders anchor as hard as worked examples do. Use helper text above the field instead.
- The section label is small and quiet. Knowing you're in "Money" is orienting; making it a header is not.
- Progress dots, not a percentage bar — a bar at 43% invites rushing.
- "Saved" is persistent, not a toast.

### 4.4 Long text (Q1, Q13, Q15)

Auto-growing textarea, minimum 6 visible lines. Character counter appears only when a minimum applies (Q1: 200), and it counts **up to** the minimum rather than down from a maximum, so it reads as encouragement rather than a limit.

No coach on any of these three.

### 4.5 Sentence completion (Q2)

Inline blanks rendered as underlined input runs within the sentence:

> The people who would miss it most are ⎡__________⎤ , because ⎡__________⎤ .

On mobile these stack, each with its fragment label above it. Never collapse into two anonymous boxes — the sentence structure is doing the cognitive work.

### 4.6 Metric triple (Q3)

Three fields with visible relationships:

```
What would you count?      [ metric name        ]
How many?                  [ number ]  [ unit   ]
Why that one?              [ one line           ]
```

`number` accepts digits with separators. `unit` is free text, **not a dropdown** — a dropdown would supply the options, which is exactly the anchoring this question is designed to avoid.

### 4.7 Ranking (Q8) — the hard one on mobile

Drag-and-drop on touch is fragile. Use **tap-to-assign** instead:

```
Tap in order, first to last.

  ┌─────────────┐  ┌─────────────┐
  │ PedConnect  │  │  TeachDay   │
  └─────────────┘  └─────────────┘
  ┌─────────────┐  ┌─────────────┐
  │  ParentUp   │  │  [App 4]    │
  └─────────────┘  └─────────────┘

  Your order:  1. TeachDay   ✕
               2. PedConnect ✕
```

Each tap moves a card into the ordered list with its position number. ✕ returns it to the pool. Works with one thumb, works with a screen reader, no drag library.

Card order in the pool is **randomised per respondent** — a fixed order subtly signals a default ranking.

Below the ranking, two further inputs on the same screen: the delete-one radio, and the "what will the group say" prediction (a second, collapsed ranking that expands on tap).

### 4.8 Matrix grid (Q5)

Nine rows × four columns of checkboxes does not fit a phone.

**Mobile:** pivot to column-major. One column per screen, four short screens:
> *"Who **pays** us?"* — nine checkboxes, multi-select
> then *"Who **decides** to adopt?"* … and so on.

Same data, four light screens instead of one impossible grid. Show a "1 of 4" sub-progress indicator so it doesn't feel like the form grew.

**Desktop:** true grid with sticky headers and full-row hover highlight.

### 4.9 Single choice + required reason (Q6)

Radio group, then a textarea that is **disabled until a choice is made** and required after. The Continue button explains itself when blocked: "Add a line about why" rather than a generic disabled state.

### 4.10 Paired rows with a star (Q11)

Three repeating blocks:

```
  Priority 1
  What          [                              ]
  Done when     [                              ]
  ☆ This is the most important one

  Priority 2 …
```

The star is a radio across all three, not a checkbox. Selecting a second star clears the first, with a brief inline note: *"Only one can be the most important — that's the point."*

Only the first block is required. Two and three are optional, which quietly discourages padding to three.

### 4.11 Multi-select with cap + ownership grid (Q14)

- (a) Function chips, max 3. On reaching 3 the remaining chips dim; tapping a dimmed chip shows *"Pick at most 3 — swap one out."* Never silently ignore a tap.
- (b) One short field per teammate, names pre-filled from the cohort roster.
- (c) Hours slider 0–60, current value shown large. Default position is **unset**, not 40 — a default is an anchor.
- (d) **The private field.** Visually distinct: inset panel, lock glyph, and its own copy:

> **Only Paul sees this one.** Not in any comparison, not in any export, not shown to the group.
>
> Is there anything that would make you step back from this, that you haven't said out loud yet?
>
> *[textarea]*   — leaving this blank is completely fine.

### 4.12 Review before submit

All fifteen questions, collapsed to answer summaries, each with an edit link that returns to the question and back. Unanswered optional questions listed separately under "You skipped these — that's allowed."

Submit button is secondary-styled until every required question is answered.

### 4.13 Submit confirmation

A real decision point, not a rubber stamp:

> **Submitting locks your answers.**
> You won't be able to change them afterwards — that's deliberate, so the baseline stays a baseline. You'll still be able to edit the OPSP that gets built from them.
>
> [ Not yet ]   [ Submit and lock ]

### 4.14 Your OPSP

Header, unmissable, above everything:

> **Your draft. Not the company's plan.**
> This is what your answers add up to. Everyone gets a different one. We'll build the real one together.

Layout: classic OPSP grid on desktop (cells in columns), vertically stacked cards on mobile. Each cell shows its content, an **ink** or **pencil** marker, and a small "from Q3, Q4" provenance line.

Pencil cells carry a short note: *"You marked low confidence here — worth revisiting after beta."* Empty cells stay empty and say *"You didn't answer this — that's fine, leave it blank."* Nothing is invented to fill a hole.

**"How to read this"** is a persistent right-hand panel on desktop, a bottom sheet on mobile. Tapping any cell scrolls the panel to that cell's explanation: what the cell is for, what a strong one looks like, what a weak one looks like. Static content. Roughly 40 words per cell.

### 4.15 Edit OPSP

Inline editing, click-to-edit per cell. A persistent note in the edit bar:

> Editing this doesn't change your survey answers — those stay as you submitted them.

Ink/pencil is manually togglable per cell, since the respondent may be more or less sure after seeing the whole thing.

### 4.16 PDF export

Print-optimised layout, not a screenshot. One page if it fits, two if not. Includes name, date, "Your draft — not the company's plan", ink/pencil distinction preserved via weight and border. **Excludes Q14(d) unconditionally.**

### 4.17 Admin — dashboard

Roster table: name, status (not started / in progress / submitted), progress, last active, time spent. **No answer content on this screen** — the facilitator will open it often and shouldn't absorb answers piecemeal before reading them properly.

Header strip shows the current degradation level and, at L1/L2, a plain-language reason: *"Running on rule-based checks — AI budget at 94%."*

### 4.18 Admin — per-question comparison

The workhorse screen.

```
Q7 · Brand promise                    Hard split ▲
──────────────────────────────────────────────────
Attributed  ⇄  [ Anonymised ]         [Analyse ✨]

 ┌────────────────────┐ ┌────────────────────┐
 │ "…show the parent, │ │ "…cut two hours of │
 │  therapist and     │ │  admin per         │
 │  doctor the same   │ │  therapist a week" │
 │  record, live."    │ │                    │
 │  confidence 5      │ │  confidence 4      │
 └────────────────────┘ └────────────────────┘
```

- Cards in a responsive grid, equal height, full text visible without truncation where possible.
- Divergence badge computed deterministically — **aligned / soft split / hard split** — visible before any AI runs.
- **Anonymised is the default mode.** Switching to attributed requires a confirm: *"This shows names. Don't use this while projecting."*
- In anonymised mode card order re-randomises on every load, so position can't be used to infer identity across sessions.

### 4.19 Admin — AI analysis

Opens as a side panel, never replacing the raw answers. The answers stay on screen next to the analysis at all times — the facilitator should always be able to check the read against the source.

Structure of the output:
- **Where you agree** — with the shared position stated plainly
- **Where you don't** — each position stated in the respondents' own words, no adjudication
- **What to ask in the room** — 2–3 concrete questions

Footer: model name, timestamp, [Re-run]. And a standing label: *"Prep material. Not a finding to show the team."*

At L2/L3 this panel is replaced by the deterministic scoring breakdown and an export button, presented as its own feature rather than as a downgrade.

### 4.20 Official OPSP canvas (P4)

Same grid as the individual OPSP. Per cell:

- **Source cards** — pull any respondent's answer in. UI: `[+ Add someone's answer]` → picker → the answer attaches as a small card under the cell, attributed.
- `[Synthesise]` appears once 2+ sources are attached.
- **Conflict result state:** when the AI refuses to synthesise, the cell shows both positions side by side and a prompt: *"These two don't reconcile. Someone has to choose."* with a `[Record the decision]` action. There is deliberately no "merge anyway" button.
- Accepted cells show provenance: *"from Ern (Q7), Paul (Q7)"*.

---

## 5. The coach — interaction pattern

### 5.1 Appearance

Triggered when the respondent taps Continue on a coachable question. The button shows a brief inline pending state (max 6s, then the system drops a level silently and validates deterministically).

The card appears **below the field**, field keeps focus, page does not jump:

```
┌────────────────────────────────────────┐
│  That's a direction, not a number.     │
│  What would you count to know it       │
│  happened?                             │
│                                        │
│  [ Let me revise ]  [ Show me an       │
│                       example ]        │
│  [ Keep it as is → ]                   │
│                                        │
│  nudge 1 of 3                          │
└────────────────────────────────────────┘
```

### 5.2 Rules

- **"Keep it as is" is present on nudge 1** and every nudge after. Non-negotiable — see `spec.md` PR4.
- The attempt counter is shown honestly. People relax when they can see the ceiling.
- After nudge 3, the card is replaced by a closing line and the coach never returns for that question: *"Fair enough — going with yours."*
- Examples appear only on request, expanding within the same card. One example, neutral domain, clearly labelled as a shape not a suggestion:

> *An example from a completely different business, just to show the shape:*
> *"Orders delivered same-day — 500 a week."*
> *Something to count, then a number. Yours will be about Anakloud, not deliveries.*

- The coach never re-evaluates an unchanged answer. Tapping Continue twice on identical text advances.

### 5.3 Tone

Short. Slightly informal. Never congratulatory — no "Great answer!". When an answer passes, the coach says nothing at all and the screen simply advances. Silence on success is what keeps the nudges meaningful.

### 5.4 What it looks like at L2

Identical card, identical buttons, fixed hint text from the static set. The respondent cannot tell the difference, which is the whole design goal. The only observable change: the "Show me an example" content is pre-written rather than generated, and it is the same for everyone — a deliberate, accepted, and documented anchoring cost of running cheap.

---

## 6. States

| State | Treatment |
|---|---|
| **Saving** | "Saving…" in the persistent save slot |
| **Saved** | "✓ Saved" — stays, doesn't fade |
| **Offline** | "Saved on this device — will sync when you're back online." Answering continues uninterrupted |
| **Sync conflict** | Server wins on lock status, local wins on content; never silently discard typed text |
| **Session expired** | Never happens mid-questionnaire. Links do not expire until the facilitator closes the cohort |
| **Already submitted** | Read-only view of answers + link to the OPSP |
| **Admin locked** | "Finish your own answers first." with a link. Not an error, a rule |
| **Cohort closed** | Read-only for everyone, OPSP and PDF still accessible |
| **AI down** | Invisible to respondents. Visible to facilitator as a level indicator with reason |

---

## 7. Accessibility

- All interactions reachable by keyboard; ranking has explicit up/down buttons as an alternative to tapping.
- Ink/pencil distinguished by weight, border style and a text tag — never by colour alone.
- Coach card announced via `aria-live="polite"` so it doesn't interrupt typing.
- Confidence and hours sliders have paired numeric inputs.
- Minimum 4.5:1 contrast throughout; 44px minimum touch targets.
- The matrix pivot (§4.8) is the accessible path on all screen sizes, not just mobile — offer it as a toggle on desktop too.

---

## 8. Microcopy principles

The copy is doing psychological work. Three rules:

**Name the discomfort before it happens.** People are about to write down that they might leave, or that they think a teammate's app should be deleted. Copy that acknowledges this — *"if your answer is different from everyone else's, that's the most useful thing here"* — gets honest answers. Copy that pretends it's a routine form gets safe ones.

**Never use survey-platform voice.** No "Thank you for your valuable feedback." No "Question 7 of 15 — you're doing great!" This is a founder talking to their co-founders.

**Make the constraints sound like reasons, not rules.** *"Only one can be the most important — that's the point"* lands better than *"Only one selection allowed."*

---

## 9. Out of scope for P1

Dark mode · multi-language toggle (Taglish is handled by *not* validating, no UI needed) · realtime presence · comments/discussion threads on answers · notifications and reminders · animated transitions · file uploads.
