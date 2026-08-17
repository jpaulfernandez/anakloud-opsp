# Align — Technical Infrastructure

**Version:** 0.1 draft
**Date:** 16 August 2026
**Related docs:** `spec.md`, `ui_ux.md`

---

## 1. Stack

Recommended, but **match your existing Anakloud stack if it differs** — the value of practising on the stack you'll actually use outweighs any advantage below.

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js (App Router) + TypeScript | Server routes keep the AI key server-side; one deploy target |
| Database | Postgres (Supabase or Neon) | JSONB for answer payloads, row-level security, cheap at this scale |
| Auth | **None conventional** — tokenised invite links | Six known people. Passwords and OAuth are overhead with no benefit here |
| Styling | Tailwind | Fast; print styles matter (§7) |
| AI | Anthropic API, server-side only | Structured outputs make the coach contract enforceable |
| PDF | Print CSS first, headless Chromium second | See §7 |
| Hosting | Vercel (app) + managed Postgres | Free tier is sufficient for one cohort |
| Email | Resend or similar, optional | Only for resending lost links |

**Deliberately excluded:** realtime subscriptions, a queue, Redis, a vector DB, any drag-and-drop library. At n=6 these add failure modes and no capability.

---

## 2. Architecture

```
  Browser
    │  invite token in URL → httpOnly session cookie
    │  optimistic local state + localStorage mirror
    ▼
  Next.js server routes ─────────────────────────┐
    │                                            │
    ├─ answers      → Postgres                   │
    ├─ opsp         → Postgres                   │
    ├─ validate     → deterministic validators ──┤ never leaves the server
    ├─ coach        → AI gateway ──┐             │
    ├─ analyse      → AI gateway ──┤             │
    └─ pdf          → renderer     │             │
                                   ▼             │
                          ┌─────────────────┐    │
                          │   AI Gateway    │    │
                          │  budget check   │    │
                          │  circuit break  │    │
                          │  timeout/retry  │    │
                          │  output guard   │    │
                          │  audit log      │    │
                          └────────┬────────┘    │
                                   ▼             │
                          Anthropic API          │
                                                 │
   any failure above ──────────────────────────► drop a level (§6)
```

**The single most important structural rule:** nothing in the request path from browser to a completed questionnaire touches the AI gateway synchronously in a way that can fail the request. The coach is an enhancement bolted to the side of a form that works without it.

---

## 3. Data model

```sql
-- One cohort per run of the exercise. Designed in from the start
-- because retrofitting multi-tenancy later is painful (spec.md §11.2).
cohorts (
  id              uuid pk,
  name            text,              -- "Anakloud Q4 2026"
  quarter_label   text,
  opens_at        timestamptz,
  closes_at       timestamptz,
  status          text,              -- draft | open | closed
  ai_level_pin    text null,         -- null = auto; L0..L3 = forced
  created_at      timestamptz
)

respondents (
  id              uuid pk,
  cohort_id       uuid fk,
  display_name    text,
  email           text null,
  invite_token    text unique,       -- 32 bytes, base64url
  resume_code     text,              -- 6 chars, unambiguous alphabet
  is_facilitator  bool default false,
  started_at      timestamptz null,
  submitted_at    timestamptz null,  -- non-null ⇒ answers immutable
  unlocked_by     uuid null,         -- audit: facilitator who reopened
  unlocked_at     timestamptz null
)

answers (
  id              uuid pk,
  respondent_id   uuid fk,
  question_id     text,              -- 'q1'..'q15', stable across versions
  value           jsonb,             -- shape per question type, §4
  confidence      smallint null,     -- 1..5, only where required
  is_private      bool default false,-- true for q14d only
  updated_at      timestamptz,
  unique (respondent_id, question_id)
)

-- Immutable snapshot written at submit. The baseline of record.
-- Even a facilitator unlock does not alter this row.
answer_snapshots (
  id              uuid pk,
  respondent_id   uuid fk,
  payload         jsonb,             -- all answers, frozen
  taken_at        timestamptz
)

opsp_drafts (
  id              uuid pk,
  cohort_id       uuid fk,
  owner_type      text,              -- 'individual' | 'official'
  owner_id        uuid null,         -- respondent_id when individual
  version         int,
  cells           jsonb,             -- { cell_key: {content, mark, sources[]} }
  label           text null,         -- "Q4 2026 v1"
  created_at      timestamptz
)

ai_interactions (
  id              uuid pk,
  respondent_id   uuid null,
  question_id     text null,
  purpose         text,              -- 'coach' | 'analysis' | 'synthesis'
  attempt_no      smallint null,     -- 1..3 for coach
  level           text,              -- L0 | L1 | L2 — what actually served it
  model           text null,
  verdict         text null,
  hint_text       text null,
  example_shown   bool default false,
  answer_changed  bool null,         -- did they edit after the nudge?
  input_tokens    int default 0,
  output_tokens   int default 0,
  guard_tripped   text null,         -- which output guard rejected it, if any
  created_at      timestamptz
)

ai_budget (
  cohort_id       uuid pk fk,
  input_cap       int,
  output_cap      int,
  input_used      int default 0,
  output_used     int default 0,
  circuit_open    bool default false,
  circuit_reason  text null,
  circuit_until   timestamptz null
)
```

**`ai_interactions.answer_changed` is the contamination audit** (spec.md FR-20). After the cohort completes, run: of coached answers where an example was shown, did they converge more than uncoached ones? If yes, the coach is influencing content and the prompt needs tightening. This is the check that tells you whether the design principle actually held.

### 3.1 Answer value shapes

```ts
q1  | q13 | q15 : { text: string }
q2              : { who: string; because: string }
q3              : { metric: string; value: number; unit: string; why: string }
q4              : { text: string }
q5              : { pays: Role[]; decides: Role[]; uses: Role[]; benefits: Role[] }
q6              : { choice: 'center'|'parent'|'pedia'|'therapist'; why: string }
q7              : { text: string }              // ≤120 chars
q8              : { rank: AppId[]; delete: AppId; why: string; predicted: AppId[] }
q9              : { items: [string, string, string] }
q10             : { payer: string; model: string; amount: number;
                    unit: string; first_peso: string }   // YYYY-MM
q11             : { rocks: { what: string; done_when: string }[]; starred: 0|1|2 }
q12             : { text: string }              // ≤40 chars
q14             : { wants: FunctionId[];        // ≤3
                    others: Record<respondentId, FunctionId>;
                    hours: number;
                    private_note: string }      // ← is_private row
```

Store `q14.private_note` as its **own row** with `is_private = true`, not nested inside the q14 payload. This makes exclusion from exports and AI payloads a query-level guarantee rather than a filtering step someone can forget.

---

## 4. API surface

| Route | Method | Notes |
|---|---|---|
| `/api/session/claim` | POST | Exchange invite token or resume code for a session cookie |
| `/api/answers` | PATCH | Upsert one answer. Rejects with 409 if `submitted_at` is set |
| `/api/answers` | GET | All own answers |
| `/api/validate` | POST | **Deterministic only.** Never calls AI. Always available |
| `/api/coach` | POST | AI coach. May return `{level:'L2', ...}` |
| `/api/submit` | POST | Locks answers, writes `answer_snapshots`, generates OPSP draft v1 |
| `/api/opsp/:id` | GET / PATCH | Read and edit an OPSP draft |
| `/api/opsp/:id/pdf` | GET | Rendered PDF |
| `/api/admin/roster` | GET | Facilitator only. Gated on own `submitted_at` |
| `/api/admin/question/:qid` | GET | Comparison data + deterministic divergence |
| `/api/admin/analyse` | POST | AI analysis. Degrades to scoring-only |
| `/api/admin/export` | GET | CSV. Private rows excluded at the query level |
| `/api/admin/synthesise` | POST | P4. Conflict guard applies |

**Admin gate:** middleware on every `/api/admin/*` route checks `is_facilitator AND submitted_at IS NOT NULL`. Enforced server-side; the UI check is cosmetic.

---

## 5. The AI layer

### 5.1 Coach — request

Sent to the model: question metadata and the answer text. **Never** the respondent's name, ID, email, other answers, or any other respondent's answers. Each call is stateless and sees exactly one answer.

### 5.2 Coach — system prompt

```
You review a single answer to a single strategy question. You check
whether the answer is USABLE. You never comment on whether it is CORRECT.

You are reviewing form, not content. This is absolute.

YOU MAY:
- Say an answer is not measurable, is ambiguous, contains two answers
  where one was asked for, or is too short to interpret.
- Ask one neutral question that helps the person be more concrete,
  e.g. "What would you point at to show this happened?"
- If and only if example_requested is true, give ONE example from a
  NEUTRAL DOMAIN: a bakery, gym, laundry, courier, or hardware store.

YOU MUST NOT:
- Suggest a metric, number, customer type, business model, priority,
  risk, product, or value. Not even as a "for instance".
- Mention healthcare, therapy, clinics, doctors, patients, parents,
  children, schools, teachers, or software products. If the neutral
  example you are about to give touches any of these, choose another.
- Say or imply the answer is good, bad, right, or wrong.
- Refer to any other answer or person.
- Exceed 25 words in `hint`.

If the answer is usable, return verdict "ok" and an empty hint. Say
nothing when someone has done well.

Bias toward "ok". A blunt, short, strongly-held answer is usable.
Only flag answers that genuinely cannot be interpreted or verified.
```

### 5.3 Coach — structured output

```json
{
  "verdict": "ok" | "needs_work",
  "dimension": "measurability" | "specificity" | "single_answer" | "too_short" | null,
  "hint": "string, ≤25 words, empty when ok",
  "example": "string, neutral domain, only when requested, else empty"
}
```

Enforce with the API's structured-output/tool-use mode so malformed responses are impossible rather than merely unlikely.

### 5.4 Output guard — runs on every coach response before it reaches the browser

A prompt is a request, not a guarantee. This is the enforcement.

1. **Banned-term scan** on `hint` and `example`. Blocklist: therapy, therapist, clinic, clinical, doctor, physician, pedia, pediatric, patient, parent, child, children, school, teacher, SPED, referral, center/centre, app, platform, software, subscription, SaaS, user, plus the four app names. Case-insensitive, stem-matched.
2. **Length check** — `hint` ≤ 25 words.
3. **Number check** — `hint` must contain no digits. A number in a hint is a suggested target.
4. **Verdict sanity** — `verdict: "ok"` must come with an empty hint.

Any failure: discard the model output, serve the static L2 hint for that question, and log `guard_tripped`. The respondent sees a normal card. Do not retry — a tripped guard means the prompt is leaking, and it should show up in the log rather than be papered over.

### 5.5 Facilitator analysis

Different prompt, looser content rules, one hard constraint:

```
You are preparing a facilitator for a founders' alignment session.
Report what the answers say. Do not decide who is right.

Structure:
- Where they agree: the shared position, stated plainly.
- Where they don't: each position in the respondents' own words.
  Never merge, soften, or rank the positions.
- What to ask in the room: 2-3 specific questions that would force
  the disagreement into the open.

Never recommend a strategy. Never say which view is better. If a
disagreement looks like a difference in wording rather than
substance, say so explicitly — that is the one judgement you may make.
```

Payload excludes names (respondents referred to as A, B, C) and excludes every `is_private` row.

### 5.6 Synthesis and the conflict guard (P4)

Two-step, deliberately:

**Step 1 — classify.** Given 2+ source answers for one OPSP cell, return `{compatible: bool, reason: string}`. Compatible means they can be stated as one thing without either party losing something they said.

**Step 2 — synthesise, only if compatible.** Draft one statement.

If incompatible, the API returns the conflict and the UI shows both positions with a `[Record the decision]` action (`ui_ux.md` §4.20). **There is no override path and no "merge anyway" endpoint.** This is the "decide, don't average" rule from the session guide, made structural. A team under time pressure at 4pm in a long session will take the merge button if it exists, and the merged sentence will be the thing nobody follows.

---

## 6. Degradation

### 6.1 Level selection

Evaluated per request, in order:

```
if cohort.ai_level_pin        → use it
if budget exhausted            → L2
if circuit_open                → L2
if p95 latency > 6s (last 20)  → L1
if 3 consecutive failures      → open circuit (5 min), → L2
else                           → L0
```

Circuit breaker: opens for 5 minutes, then admits one probe request. Success closes it; failure reopens with the interval doubled, capped at 30 minutes.

### 6.2 Per-request safety

- Timeout 6s, one retry only on 429/503 with jittered backoff. Never retry a timeout — the respondent is waiting.
- On any exception, fall through to the deterministic validator. **`/api/coach` never returns a 5xx to the browser**; it returns a valid coach response served at a lower level.

### 6.3 Deterministic validators

Implemented in `lib/validators.ts`, pure functions, no I/O, no network. Full rules in `spec.md` §7.1. These run at **every** level including L0 — the AI is consulted only after the deterministic check passes, so obvious problems never cost a token.

```ts
type Verdict = {
  ok: boolean
  dimension?: Dimension
  hint?: string        // static, pre-written, matched to coach tone
  example?: string     // static, neutral domain
}

export const validators: Record<QuestionId, (v: unknown) => Verdict>
```

Static hints and examples live in `lib/static-hints.ts`, written once, reviewed against the same constraints as §5.2. Accepted tradeoff: at L2 every respondent who requests an example sees the same one. That is a known anchoring cost, documented, and cheaper than the alternative of having no fallback.

### 6.4 Budget controls

- Per-cohort caps on input and output tokens, set at cohort creation.
- Per-respondent cap: refuses further coach calls past a ceiling (default 40 calls — well above 3 × 8 coachable questions, so it only catches abuse or a loop bug).
- Per-request output cap: 200 tokens for coach, 1500 for analysis.
- Counters incremented **inside the same transaction** as the interaction log, so a crash can't lose spend.
- Warnings surfaced to the facilitator dashboard at 70% and 90%.
- At 100%: circuit opens permanently for the cohort, level pins to L2, dashboard shows a plain-language note. **No respondent-visible change.**

**Rough scale check.** ~8 coachable questions × up to 3 nudges × 6 people ≈ 144 coach calls, ~300 input / ~80 output tokens each. That is a trivially small spend — under a dollar on current pricing. The budget machinery exists to protect against a retry loop, not against normal use. Build it anyway; loops happen.

---

## 7. PDF pipeline

**Primary:** print-optimised CSS + `window.print()`. Zero dependencies, zero server cost, and users can save-as-PDF from any device. Requires a real `@media print` stylesheet — page breaks between OPSP sections, ink/pencil expressed through weight and border style so it survives greyscale.

**Secondary (server-side):** headless Chromium via Playwright rendering an authenticated print route to PDF. Chromium is pre-installed in most container images; do not bundle a second browser.

**Do not use** a JS PDF-building library. The OPSP is a grid with mixed typographic weights, and hand-building that layout in a PDF DSL costs more time than it saves and drifts from the on-screen version.

Every PDF path queries answers with `is_private = false`. Enforce in the query, not in the template.

---

## 8. Testing

Beyond ordinary unit and E2E coverage, three tests specific to this product's risks:

**T1 — Coach containment (automated, blocks P2 release).**
30 fixture answers spanning all coachable questions, including deliberately vague ones. Run each through the live coach at L0. Assert: zero banned terms in any hint or example, zero digits in any hint, no hint over 25 words. Run this on every prompt change. This is acceptance criterion #8 in `spec.md` §10.

**T2 — Key-removal test (blocks P1 release).**
Remove `GEMINI_API_KEY` from the environment entirely. Run the full E2E suite: invite → answer all 15 → submit → OPSP → PDF → admin comparison → CSV. Everything must pass. This is the real test of principle PR3, and it is a one-line change to run.

_Migration note (2026-08-17, F16-T03):_ the active credential is `GEMINI_API_KEY`. The former `ANTHROPIC_API_KEY` is historical; the T2 gate unsets the Gemini name.

**T3 — Lock integrity.**
After submit, every mutation path against `answers` returns 409. Property-test it rather than checking the happy path — this is what protects the baseline.

Plus: a seed script that generates six fake respondents with deliberately conflicting answers, so the admin comparison and divergence scoring can be developed without waiting for real humans.

---

## 9. Security and privacy

- Invite tokens: 32 random bytes, base64url, single-use exchange for an httpOnly, SameSite=Lax session cookie. Tokens revocable per respondent.
- Resume codes: 6 characters from an unambiguous alphabet (no O/0, I/1). Rate-limited to 5 attempts per IP per hour.
- Row-level security keyed on respondent identity; facilitator role grants cohort-wide read except where `is_private` and the reader is not the facilitator.
- The AI key exists only as a server environment variable. No client bundle reference, verified by a build-time check.
- AI payloads carry answer text and question metadata only — no names, no emails, no IDs.
- **`is_private` rows are excluded at the query layer** in every export, PDF, and AI payload. Do not rely on template-level filtering.
- Full cohort deletion in one facilitator action, cascading.
- Application logs never contain answer text.

**Privacy note.** This tool holds no patient data and sits outside the Anakloud clinical compliance scope. It does hold candid personal statements by identifiable people — including, in Q14(d), things like "I may need to leave." Handle it accordingly, and list it in the company data inventory when that inventory is created (which is itself a good candidate for a Q11 rock).

---

## 10. Environments and deploy

| Env | Purpose | AI |
|---|---|---|
| `local` | Development | L2 pinned by default, so the fallback path is what developers see daily |
| `preview` | Per-PR | L2 pinned. Never bill a preview branch |
| `production` | The real cohort | L0, budget-capped |

Pinning local and preview to L2 is a deliberate choice: it means the fallback path is exercised constantly by the people building it, rather than being the code path nobody has run since it was written.

Required env vars:

```
DATABASE_URL
GEMINI_API_KEY           # optional — absence must be non-fatal (T2)
AI_MODEL                 # pinned model id, not an alias
AI_LEVEL_PIN             # optional: L0..L3
SESSION_SECRET
RESEND_API_KEY           # optional
```

_Migration note (2026-08-17, F16-T03):_ `GEMINI_API_KEY` is the active optional AI credential. The former `ANTHROPIC_API_KEY` is historical and is no longer read for a provider lookup; it is retained only as a client-bundle leak-scan target during the migration.

Pin the model id explicitly. A silent model change alters coach behaviour mid-cohort and invalidates the contamination audit.

---

## 11. Observability

- Structured logs on every AI call: purpose, level served, latency, tokens, guard result. Never the answer text.
- Facilitator dashboard surfaces: current level, budget used, circuit state, count of guard trips.
- **Guard trips are the metric that matters.** A rising count means the prompt is leaking domain content into hints, and the coach is quietly contaminating the baseline. Alert the facilitator at 3+ trips in a cohort.

---

## 12. Build order

Matches `spec.md` §9. Within P1, build in this sequence — each step leaves something demonstrable:

1. Schema, seed script, invite-link claim flow
2. Question renderer + all 12 input types (the matrix pivot and tap-ranking are the two real pieces of work here)
3. Autosave, resume, offline mirror
4. Deterministic validators + static hints — **the coach's full behaviour, minus the model**
5. Review, submit, lock, snapshot
6. OPSP generation (pure mapping function), "how to read this", editing
7. Print CSS and PDF
8. Admin roster, comparison, divergence scoring, CSV
9. **T2 key-removal test** — this is the gate on P1

Only then P2's AI gateway. Building step 4 before any AI means the fallback is the foundation and the model is genuinely optional — which is the only way principle PR3 survives contact with a deadline.
