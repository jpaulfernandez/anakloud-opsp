# CLAUDE.md

**Read [`AGENTS.md`](AGENTS.md) first and follow it.** It is the working agreement for this repository: the workflow, the non-negotiable design principles, the code style, and the list of things not to do. Everything in it applies to you.

This file only adds what is specific to working here through Claude Code.

## Before you start

Read in this order:

1. [`AGENTS.md`](AGENTS.md) — how to work here
2. [`spec/README.md`](spec/README.md) — the execution plan, feature index, and document precedence
3. [`spec/TRACKER.md`](spec/TRACKER.md) — what is in flight and what is blocked
4. The `README.md` and `tickets.md` of the feature you are about to touch

The four source documents in [`docs/`](docs/) are the authority. If a ticket and a source doc disagree, the source doc wins and the ticket is wrong; say so rather than picking one silently. Where the source docs disagree with *each other*, `spec/README.md` gives the precedence order and [`spec/COVERAGE.md`](spec/COVERAGE.md) lists the conflicts already reconciled — check there before treating an inconsistency as new.

[`LOOP.md`](LOOP.md) describes the autonomous build loop that runs this same workflow unattended.

## Session habits

- **One ticket per session where possible.** Ticket in, tested code out, tracker updated. Do not batch five tickets into one sprawling change.
- **Update [`spec/TRACKER.md`](spec/TRACKER.md) at both ends** — when you start a ticket and when you finish it. This is the only status record; nothing else is authoritative.
- **Run `./verify.sh` before claiming a ticket is done.** If it fails, say so with the output rather than describing the work as complete.
- **Surface blockers instead of routing around them.** Five inputs are still missing from the source docs; they are listed at the bottom of [`spec/README.md`](spec/README.md) and in the tracker. If you hit one, mark the ticket `Blocked` with the reason and move to work that does not depend on it.

## When you are asked to do something the spec forbids

Several rules in this project look like over-engineering until you know why they are there: no unit dropdown on Q3, no default on the hours slider, no merge button on the P4 conflict guard, no retry after a guard trip, no development bypass for the admin gate.

Each of these is load-bearing and each has its reasoning recorded in `AGENTS.md` under "Non-negotiables" and "Things not to do". If a request would cross one, say which principle it crosses and what it costs, then let the person decide. If they confirm, proceed — but do not make the change quietly on your own judgement.

## Scope discipline

This is a build for six people, used once, with a September 2026 deadline and a fallback plan of running the whole session on a Google Form. `spec.md` §9 says so plainly. Resist scope growth: no abstraction layers for a second cohort you were not asked to support, no admin CRUD nobody requested, no configuration surface for values that are fine as constants.

Build what the ticket says. If you notice something genuinely worth doing that the ticket does not cover, mention it and leave it out of the change.
