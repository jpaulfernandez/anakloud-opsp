# AGENTS.md

Instructions for coding agents working in this repository. Read this fully before touching code. It is short on purpose.

---

## What this is

A private strategy questionnaire for one founding team of six people, run once in September 2026, ahead of a company's transition from capstone project to venture. Six people answer independently, each gets a draft One-Page Strategic Plan generated from their own answers, and the facilitator gets a comparison view showing where the team agrees and where it doesn't.

The product measures **six independent opinions**. Almost every rule below exists because some ordinary-looking engineering decision would quietly destroy that measurement.

## Orientation

| Read | For |
|---|---|
| `docs/anakloud-baseline-questions.md` | The fifteen questions, their option lists, and the Part B OPSP mapping |
| `docs/spec.md` | What it does, the AI contract, the degradation ladder, acceptance criteria |
| `docs/ui_ux.md` | Screens, input types, copy, states, accessibility |
| `docs/tech_infrastructure.md` | Stack, schema, API surface, prompts, tests, build order |
| `spec/README.md` | The execution plan, feature index, and document precedence |
| `spec/TRACKER.md` | Status. The only place status lives |
| `spec/COVERAGE.md` | Requirement → ticket traceability, and the resolved doc conflicts |
| `LOOP.md` | The autonomous build loop |

Feature folders are `spec/F0n-*/`, each with a `README.md` (context) and `tickets.md` (EARS requirements + acceptance criteria).

**When documents disagree**, resolve in the order given in `spec/README.md`: baseline questions Part A and B first for question content and the OPSP mapping, then `tech_infrastructure.md` for schema and prompts, then `spec.md` for principles, then `ui_ux.md` for presentation. The conflicts already found and reconciled are listed in `spec/COVERAGE.md` — read that before "fixing" an inconsistency you think you have spotted, because several of them are deliberate.

---

## Workflow

Work one ticket at a time, in ID order within a feature, and features in numeric order. The order comes from `tech_infrastructure.md` §12 and is not arbitrary.

1. Open the ticket in `spec/F0n-*/tickets.md`. Read the feature `README.md` too — it carries the reasoning the ticket assumes.
2. Set the ticket to `In progress` in `spec/TRACKER.md`. If it is the first ticket in the feature, set the feature row to `In progress` with today's date.
3. Build it. Follow the EARS requirements literally. Every `SHALL NOT` is a hard constraint, not a preference.
4. Write the tests the acceptance criteria describe. Tests come with the code, not after the feature.
5. Run `./verify.sh`. It must be green.
6. Set the ticket to `Done`. When every ticket in the feature is `Done`, set the feature row to `Done` with the date, and update the **Last updated** and **Done** count at the top of the tracker.

If a ticket is blocked, set it to `Blocked` and write why in the Notes column. Do not leave blocked work sitting at `In progress`, and do not invent a workaround for a missing input — surface it.

This workflow is what [`LOOP.md`](LOOP.md) automates. Running under `loop.sh` changes nothing about how you work — you still get one ticket at a time and you still stop rather than working around a bad requirement.

**Do not skip ahead to the AI features.** F12 does not start until F11-T02 (the key-removal E2E) is green. The whole architecture depends on the questionnaire being complete and correct before a model is wired in.

---

## Non-negotiables

These come from `spec.md` §3. When a decision conflicts with one of these, the principle wins — including over a reasonable-sounding refactor.

**1. Uninfluenced answers are the entire product.**
Anything that leaks one person's thinking into another person's answer destroys the thing being measured. Concretely, and these are real examples from the spec:

- No placeholder text in open-text fields. Placeholders anchor as hard as worked examples.
- No dropdown for the unit field on Q3. A unit list supplies the options.
- No default value on the hours slider. A default is an anchor.
- Q8's card pool is randomised per respondent. A fixed order signals a default ranking.
- No screen shows more than one question. Someone who sees all fifteen composes a narrative across them.

**2. The AI critiques form, never content.**
It may say an answer isn't measurable. It may never suggest what to measure. The system prompt states this; the output guard enforces it. Treat the guard as the mechanism and the prompt as the request.

**3. No AI on the critical path.**
Every AI feature has a deterministic sibling that produces a usable result. Removing `ANTHROPIC_API_KEY` must leave every user-facing function working. This is tested (F11-T02) and it gates P1.

**4. Never block a submission.**
The coach nudges; it cannot gate. If a code path makes Continue unavailable because of a coach verdict, that is a defect. "Keep it as is" is present on nudge 1 and every nudge after.

**5. Original answers are immutable after submit.**
The derived OPSP is editable. The raw answers are not. Every mutation path returns 409 after submit, property-tested.

**6. Degradation must look intentional.**
No red banners, no "AI unavailable", no retry spinners in respondent-facing UI. A respondent in fallback mode sees a clean form and has no reason to think anything broke. The facilitator sees the level and the reason; the respondent sees nothing.

### Two more, from the privacy section

- **Q14(d) never leaves the database** except on the facilitator's own screen. Not in CSV, not in PDF, not in any AI payload, not in logs. It lives in its own row with `is_private = true`, and exclusion is enforced **in the SQL query**, never in a template or a filter step someone can forget.
- **AI payloads carry answer text and question metadata only.** No names, no emails, no respondent IDs, no other answers.

---

## Code style

Write plainly. This is a small application for six users; it does not need architecture.

- **Simple over clever.** If a junior developer would need to trace three files to understand a function, rewrite it.
- **No premature abstraction.** Do not add a factory, a strategy pattern, a generic wrapper, or a base class for one call site. Duplication is cheaper than the wrong abstraction and much cheaper than a framework nobody asked for.
- **No defensive try/except.** Catch an exception only where you have a specific recovery. Swallowing errors to "be safe" hides the bug and makes the degradation ladder untestable. The one place errors are caught broadly is the AI gateway, and there the recovery is explicit: drop a level.
- **Fail loudly in development, degrade quietly in production** — and only along the paths §7 of `spec.md` defines.
- **Pure functions where the spec says pure.** `lib/validators.ts`, the OPSP mapping, and the divergence scoring do no I/O and touch no network. This is what makes them testable and what makes PR3 true.
- **Comments explain why, not what.** A comment restating the code is noise. A comment explaining that the unit field is free text *because a dropdown would anchor every respondent* is the most valuable line in the file.
- **Types are real.** `strict: true`. No `any` to get past a compiler error — if the type is hard, the shape is probably wrong.
- **Flat over nested.** Early returns beat nested conditionals.
- **No new dependencies without a reason in the ticket.** `tech_infrastructure.md` §1 deliberately excludes realtime subscriptions, a queue, Redis, a vector DB, and any drag-and-drop library. At n=6 these add failure modes and no capability. The tap-to-assign ranking exists precisely so no drag library is needed.
- **No emojis in code, comments, commit messages, or UI copy** unless the copy in `ui_ux.md` has one.

### Copy is code here

`ui_ux.md` §8 is not decoration. This tool asks people to write down that they might leave the company, or that they think a co-founder's product should be killed. Copy that sounds like a corporate survey will get corporate answers. Where the UI spec gives exact wording, use it verbatim. Do not rewrite it into product voice, do not add "Thank you for your feedback", do not add encouragement. When an answer passes the coach, the coach says nothing at all — silence on success is what keeps the nudges meaningful.

---

## Testing

- Tests accompany the code in the same change. A ticket is not done because it works when you click it.
- Unit-test the pure functions exhaustively: validators, OPSP mapping, divergence scoring, the output guard.
- Property-test the lock (F11-T03). Enumerate mutation routes programmatically so a route added next month is covered automatically. Checking the happy path proves nothing — the risk is the route someone adds later.
- E2E covers the whole journey: claim → 15 answers → submit → OPSP → PDF → admin comparison → CSV.
- The key-removal run (`ANTHROPIC_API_KEY` absent) is the gate on P1. It is a one-line change to run and it is the only real test of "the AI is optional".
- The live-model containment test (30 fixtures, zero banned terms, zero digits, ≤25 words) is a separate command, not part of `./verify.sh`, because it costs money and can flake on latency. Run it on every prompt change.

---

## Commands

```bash
./verify.sh
```

Runs typecheck, lint, unit tests and Playwright, stopping at the first failure. It must pass with no AI key present.

Individual steps:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run test -- --run
```

```bash
npx playwright test --reporter=line
```

Seed six respondents with deliberately conflicting answers:

```bash
npm run db:seed
```

Run the autonomous build loop — see [`LOOP.md`](LOOP.md) first:

```bash
./loop.sh
```

The P1 gate — full E2E with the key removed:

```bash
env -u ANTHROPIC_API_KEY npx playwright test --reporter=line
```

The P2 gate — T1 coach containment at L0 (30 fixtures, live model). Separate command by design, so it needs a key and costs money — run it on every prompt or static-hint change:

```bash
npm run test:coach-containment
```

Its offline half (the same §5.4 assertions over `lib/static-hints.ts`, plus the fixture-set checks) runs inside the normal unit suite; only the live-model call is kept out of `./verify.sh`.

---

## Environment

```
DATABASE_URL
ANTHROPIC_API_KEY        # optional - absence must be non-fatal
AI_MODEL                 # pinned model id, never an alias
AI_LEVEL_PIN             # optional: L0..L3
SESSION_SECRET
RESEND_API_KEY           # optional
```

**Local and preview default to `AI_LEVEL_PIN=L2`.** This is deliberate and is not a misconfiguration to fix. It means the fallback path is the one developers exercise daily, rather than being the code path nobody has run since it was written.

**`AI_MODEL` is a pinned model id, not an alias.** A silent model change alters coach behaviour mid-cohort and invalidates the contamination audit.

---

## Things not to do

- Do not add a "merge anyway" path to the P4 conflict guard, behind a confirmation or a flag or anything else. The absence of that button is the feature. A team under time pressure at 4pm will take it, and the merged sentence will be the thing nobody follows.
- Do not add a development bypass for the admin gate. Use the seed script's already-submitted facilitator.
- Do not auto-fill an empty OPSP cell with something plausible. Blank stays blank.
- Do not retry after an output-guard trip. A tripped guard means the prompt is leaking and it should show up in the log rather than be papered over.
- Do not surface an AI error to a respondent, ever. Drop a level silently.
- Do not write answer text, invite tokens, resume codes or session values to logs.
- Do not change `question_id` values. They are stable across content revisions.
- Do not record status anywhere except `spec/TRACKER.md`.
- Do not mark a ticket done with `./verify.sh` failing.
