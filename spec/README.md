# Align — Execution Plan

Derived from [`spec.md`](../docs/spec.md), [`ui_ux.md`](../docs/ui_ux.md), [`tech_infrastructure.md`](../docs/tech_infrastructure.md), and [`anakloud-baseline-questions.md`](../docs/anakloud-baseline-questions.md).

## How this plan is organised

One folder per feature. Twenty features, numbered in **build order** — the order is not decorative. F01–F15 come from `tech_infrastructure.md` §12 and the phasing in `spec.md` §9. F16–F20 are the post-P4 Neon and Gemini migration defined in [`EXECUTION-NEON.md`](EXECUTION-NEON.md). F01→F11 is the whole of P1. Nothing in F12+ may be started before F11 is green.

Each folder contains:

| File | Purpose |
|---|---|
| `README.md` | What the feature is, phase, dependencies, exit criteria, risks |
| `tickets.md` | The work, written as EARS requirements with acceptance criteria |

Status for every ticket lives in one place: [`TRACKER.md`](TRACKER.md). Do not record status inside feature folders.

## Feature index

| # | Feature | Phase | Depends on |
|---|---|---|---|
| [F01](F01-foundation-data-model/) | Foundation & data model | P1 | — |
| [F02](F02-invite-session-onboarding/) | Invite, session & onboarding | P1 | F01 |
| [F03](F03-question-engine/) | Question engine & input types | P1 | F01, F02 |
| [F04](F04-autosave-resume-offline/) | Autosave, resume & offline | P1 | F03 |
| [F05](F05-validators-coach-shell/) | Deterministic validators & coach shell | P1 | F03 |
| [F06](F06-review-submit-lock/) | Review, submit & lock | P1 | F04, F05 |
| [F07](F07-individual-opsp/) | Individual OPSP | P1 | F06 |
| [F08](F08-print-pdf-export/) | Print & PDF export | P1 | F07 |
| [F09](F09-admin-gate-dashboard/) | Admin gate & dashboard | P1 | F06 |
| [F10](F10-comparison-divergence/) | Comparison & divergence scoring | P1 | F09 |
| [F11](F11-release-gates/) | Release gates & test harness | P1 | F01–F10 |
| [F12](F12-ai-gateway-degradation/) | AI gateway & degradation ladder | P2 | F11 |
| [F13](F13-ai-coach/) | AI coach | P2 | F12, F05 |
| [F14](F14-facilitator-analysis/) | Facilitator analysis & projection | P3 | F12, F10 |
| [F15](F15-official-opsp-canvas/) | Official OPSP canvas | P4 | F12, F07 |
| [F16](F16-gemini-configuration-guardrails/) | Gemini configuration guardrails | M | F11, F12 |
| [F17](F17-neon-runtime/) | Neon runtime | M | F01 |
| [F18](F18-gemini-provider/) | Gemini provider | M | F16, F12, F13 |
| [F19](F19-neon-environments/) | Neon environments | M | F17 |
| [F20](F20-migration-release-gate/) | Migration release gate | M | F16, F18, F19 |

## EARS conventions used here

Every requirement uses one of these five templates. If a requirement doesn't fit one, it isn't specified tightly enough yet.

| Pattern | Template |
|---|---|
| Ubiquitous | The system SHALL `<response>` |
| Event-driven | WHEN `<trigger>`, the system SHALL `<response>` |
| State-driven | WHILE `<state>`, the system SHALL `<response>` |
| Optional-feature | WHERE `<feature is present>`, the system SHALL `<response>` |
| Unwanted behaviour | IF `<trigger>`, THEN the system SHALL `<response>` |

"SHALL NOT" is used for the AI containment rules, where the prohibition *is* the requirement.

## Ticket ID scheme

`Fnn-Tnn` — e.g. `F05-T02` or `F18-T03`. IDs are permanent. If a ticket is dropped, mark it `Dropped` in the tracker; never reuse the number.

## Traceability

Every ticket carries a **Traces** line pointing at the source requirement (`FR-n`, `PR-n`, `T1`–`T3`, a migration item, or a doc section). Anything in the source documents that no ticket traces to is either out of scope or a gap — see [`COVERAGE.md`](COVERAGE.md).

## Source document precedence

Where documents disagree, resolve in this order:

1. **`anakloud-baseline-questions.md` Part A** — authoritative for question wording, input types, option lists, and the Q1–Q15 numbering.
2. **`anakloud-baseline-questions.md` Part B** — authoritative for the OPSP mapping and the ink/pencil defaults.
3. **`tech_infrastructure.md`** — authoritative for schema, payload shapes, prompts and thresholds.
4. **`spec.md`** — authoritative for principles, the AI contract, phasing and acceptance criteria.
5. **`ui_ux.md`** — authoritative for layout, states, copy and accessibility.

Known inconsistencies inside the baseline questions doc, already resolved in these tickets:

- Its Part A header says "13 questions" and refers to "Q11–Q13 are cuttable"; the body numbers Q1–Q15 and Part D nominates Q15, Q4, Q2 and Q9 as the cuttable ones. **Q1–Q15 is authoritative** — it matches `spec.md` and `tech_infrastructure.md` throughout.
- Its opening notes cross-reference "Q5" for the app ranking and "Q8/Q9" for rocks and theme. Those are stale numbers from an earlier draft; the ranking is **Q8**, rocks are **Q11**, theme is **Q12**.

## Known blockers, carried from `spec.md` §11

These are not tickets. They are inputs the plan needs from a human.

1. ~~`anakloud-baseline-questions.md` missing~~ — **resolved.** Part B supplies the OPSP mapping; F07-T01 is unblocked.
2. **The fourth app still has no name.** Q8 ranks four apps; three are named (PedConnect, TeachDay, ParentUp). The baseline doc names this itself: *"Fill in its real name before sending; a blank there biases the ranking."* Blocking for F03-T07 content and the divergence fixtures.
3. **Multi-cohort scope.** The data model in `tech_infrastructure.md` §3 already carries `cohort_id` throughout, so F01 builds it in. Confirm this is wanted before F01-T02 lands; retrofitting later is the expensive path.
4. **Does the facilitator answer?** FR-28 assumes yes and enforces it in code. F09-T01 implements the gate. If the answer is no, F09-T01 changes shape.
5. **Divergence thresholds have no numeric defaults** in any source doc. Part C defines aligned / soft split / hard split qualitatively only. F10-T01 must choose defaults, put them in config, and flag them for tuning after real data arrives.
6. **Product name.** "Align" is a placeholder. Keep it out of database identifiers and route paths so a rename is a copy change, not a migration.
