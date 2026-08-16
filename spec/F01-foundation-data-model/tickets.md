# F01 — Tickets

---

## F01-T01 — Project scaffold and verification pipeline

**Phase:** P1 · **Depends:** — · **Traces:** `tech_infrastructure.md` §1, §10

### Requirements

- The system SHALL be a Next.js App Router application written in TypeScript with `strict: true`.
- The system SHALL expose `npm run typecheck`, `npm run lint`, `npm run test`, and a Playwright E2E suite, so that `./verify.sh` runs unmodified.
- The system SHALL style with Tailwind, configured with a print variant available (F08 depends on it).
- WHEN the application boots, the system SHALL read configuration from `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_LEVEL_PIN`, `SESSION_SECRET`, and `RESEND_API_KEY`.
- IF `ANTHROPIC_API_KEY` is absent, THEN the system SHALL boot normally and SHALL NOT log an error at any level above `debug`.
- The system SHALL NOT include a drag-and-drop library, a state-management library, a queue, Redis, or a vector DB in its dependency tree.

### Acceptance

- [ ] `./verify.sh` exits 0 on a fresh clone with an empty database
- [ ] Booting with `ANTHROPIC_API_KEY` unset produces no error output
- [ ] `package.json` dependency list reviewed against the "deliberately excluded" list in `tech_infrastructure.md` §1

---

## F01-T02 — Core schema migration

**Phase:** P1 · **Depends:** F01-T01 · **Traces:** `tech_infrastructure.md` §3

### Requirements

- The system SHALL provide tables `cohorts`, `respondents`, `answers`, `answer_snapshots`, `opsp_drafts`, `ai_interactions`, and `ai_budget` with the columns and types given in `tech_infrastructure.md` §3.
- The system SHALL enforce `unique (respondent_id, question_id)` on `answers`.
- The system SHALL enforce uniqueness on `respondents.invite_token`.
- The system SHALL store every answer payload as `jsonb` matching the per-question shapes in §3.1.
- WHERE a row belongs to a respondent, the system SHALL make its cohort reachable by join without a full table scan.
- The system SHALL provide a reversible down-migration for every migration.

### Acceptance

- [ ] Migration applies and rolls back cleanly against an empty Postgres
- [ ] Inserting two answers with the same `(respondent_id, question_id)` raises a constraint violation
- [ ] A test asserts every column named in `tech_infrastructure.md` §3 exists with the stated nullability

---

## F01-T03 — Private-row separation for Q14(d)

**Phase:** P1 · **Depends:** F01-T02 · **Traces:** FR-12, `spec.md` §8, `tech_infrastructure.md` §3.1, §9

### Requirements

- The system SHALL persist `q14.private_note` as its own `answers` row with `question_id = 'q14d'` and `is_private = true`.
- The system SHALL NOT nest the private note inside the `q14` payload.
- The system SHALL provide a single query helper — used by every export, PDF and AI path — that filters `is_private = false` in the SQL, not in application code.
- IF a caller requests answer data through any path other than the facilitator's own screen, THEN the system SHALL exclude `is_private` rows at the query layer.

### Acceptance

- [ ] Writing Q14 produces two rows: `q14` (public) and `q14d` (private)
- [ ] A test greps the codebase for direct `answers` selects that bypass the helper and fails if any exist outside the facilitator read path
- [ ] The private note is absent from the result of the export helper, the PDF helper, and the AI payload builder

---

## F01-T04 — Access policy and row-level security

**Phase:** P1 · **Depends:** F01-T02 · **Traces:** `tech_infrastructure.md` §9

### Requirements

- The system SHALL restrict a respondent to reading and writing only their own `answers`, `answer_snapshots` and individual `opsp_drafts` rows.
- WHERE the reader is the facilitator of the cohort, the system SHALL grant cohort-wide read.
- IF the reader is not the facilitator, THEN the system SHALL deny reads of rows where `is_private = true`, including the reader's own.
- The system SHALL enforce these rules server-side; client-side checks are cosmetic and SHALL NOT be the only enforcement.

### Acceptance

- [ ] Respondent A cannot read respondent B's answers through any API route
- [ ] A non-facilitator reading their own `q14d` through an export path receives nothing
- [ ] Policies covered by integration tests, not only by inspection

---

## F01-T05 — Seed script

**Phase:** P1 · **Depends:** F01-T02, F01-T07 · **Traces:** `tech_infrastructure.md` §8

### Requirements

- The system SHALL provide `npm run db:seed`, creating one cohort and six respondents, one of whom is the facilitator.
- The seed SHALL populate all fifteen questions for each respondent with answers that **deliberately conflict** — including at least one aligned question, one soft split, and one hard split, so F10 divergence scoring can be developed without real humans.
- The seed SHALL populate confidence values on Q3, Q4, Q7, Q8, Q10 and Q11.
- The seed SHALL populate at least two `q14d` private rows, so private-exclusion tests have something to exclude.
- WHEN the seed runs a second time, the system SHALL produce the same result without duplicating rows.

### Acceptance

- [ ] Running the seed twice leaves six respondents, not twelve
- [ ] Seeded data yields at least one `aligned`, one `soft split` and one `hard split` under F10's scoring
- [ ] Seeded private rows exist and are excluded from CSV export

---

## F01-T06 — Environment config and level pinning

**Phase:** P1 · **Depends:** F01-T01 · **Traces:** `tech_infrastructure.md` §10, PR3

### Requirements

- WHERE the environment is `local` or `preview`, the system SHALL default `AI_LEVEL_PIN` to `L2`.
- WHERE the environment is `production`, the system SHALL default to automatic level selection.
- The system SHALL treat `AI_MODEL` as a pinned model identifier and SHALL NOT accept an alias.
- IF `AI_MODEL` is unset while the resolved level is `L0` or `L1`, THEN the system SHALL drop to `L2` rather than call the provider.

### Acceptance

- [ ] A developer running locally with a valid key still sees L2 behaviour by default
- [ ] A test asserts `AI_MODEL` is rejected when it matches a known alias pattern
- [ ] The pinning behaviour is documented in `AGENTS.md` so nobody "fixes" it

**Note.** Pinning local and preview to L2 is the point, not an oversight — the fallback path is the one that must never rot.

---

## F01-T07 — Question registry

**Phase:** P1 · **Depends:** F01-T01 · **Traces:** FR-10, FR-11, FR-21, `spec.md` §6.3, `tech_infrastructure.md` §3.1

### Requirements

- The system SHALL define all fifteen questions in one typed registry, keyed `q1`–`q15`, carrying: section label, question text, helper text, input type, required/optional, whether a confidence slider applies, and whether the coach runs.
- The system SHALL mark exactly Q3, Q4, Q7, Q8, Q10 and Q11 as confidence-bearing.
- The system SHALL mark exactly Q3, Q4, Q6, Q7, Q9, Q10 and Q11 as coachable.
- The system SHALL NOT mark Q1, Q2, Q5, Q8, Q12, Q13, Q14 or Q15 as coachable.
- The system SHALL derive the TypeScript answer-value type for each question from the shapes in `tech_infrastructure.md` §3.1.
- The system SHALL keep `question_id` values stable across content revisions.

### Acceptance

- [ ] A test asserts the coachable set is exactly `{q3,q4,q6,q7,q9,q10,q11}`
- [ ] A test asserts the confidence set is exactly `{q3,q4,q7,q8,q10,q11}`
- [ ] Changing question copy does not change any `question_id`
- [ ] Every input type named in FR-10 appears in the registry at least once

**Note.** `spec.md` §6.3 lists Q8 as *not* coached but FR-11 lists Q8 as confidence-bearing. Both are intentional and both are asserted above — Q8 carries a confidence slider and no coach.
