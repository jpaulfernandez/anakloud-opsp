# F01 — Foundation & data model

**Phase:** P1 · **Depends on:** nothing · **Blocks:** everything

## What this is

The repository, the schema, the question registry, and the seed data. Nothing in this feature is user-visible. Its job is to make every later feature cheap, and to build two structural guarantees in at the bottom of the stack where they cannot be forgotten later:

1. **`cohort_id` on everything.** Multi-cohort is nearly free now and painful to retrofit (`spec.md` §11.2).
2. **`q14d` lives in its own row with `is_private = true`.** Exclusion from exports, PDFs and AI payloads becomes a query-level guarantee rather than a filtering step a future developer forgets (`tech_infrastructure.md` §3.1).

## Scope

- Next.js App Router + TypeScript + Tailwind scaffold, with the four verify commands wired
- Postgres schema exactly as `tech_infrastructure.md` §3
- Question registry — one typed source of truth for all fifteen questions
- Seed script producing six respondents with deliberately conflicting answers
- Environment config, including the per-environment AI level pin

## Exit criteria

- `./verify.sh` runs green on an empty app
- `npm run db:seed` produces a cohort of six with conflicting answers, idempotently
- The question registry is imported by at least one test asserting all fifteen questions are present with correct type, coachable flag, and confidence flag
- No table lacks a cohort path

## Risks

- **The question registry is the highest-leverage file in the project.** F03, F05, F07, F10 and F13 all read from it. Get the shape right before writing input components against it.
- The Part B OPSP mapping table is missing (see plan blocker 1). F01-T07 defines the registry regardless; F07 supplies the mapping.
