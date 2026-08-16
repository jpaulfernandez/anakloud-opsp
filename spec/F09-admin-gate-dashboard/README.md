# F09 — Admin gate & dashboard

**Phase:** P1 · **Depends on:** F06 · **Blocks:** F10, F14

## What this is

The facilitator's home, and the rule that keeps the facilitator honest.

FR-28: **the admin view stays locked until the facilitator's own responses are submitted, enforced in code, not by convention.** The reason is PR1 — if Paul reads five people's answers before writing his own, his baseline is contaminated and the sixth data point is worthless. Discipline will not hold at 11pm the night before the session; a middleware check will.

The dashboard itself is deliberately content-free. The facilitator will open it often, and it must not leak answers piecemeal before they are read properly (`ui_ux.md` §4.17).

## Scope

- Server-side admin gate on every `/api/admin/*` route
- Admin-locked UI state, presented as a rule rather than an error
- Roster dashboard: names, status, progress, last active, time spent
- Level and budget header strip
- Cohort lifecycle: open, close, delete

## Exit criteria

- The facilitator cannot reach any admin route before their own `submitted_at` is set — verified by test against the API, not the UI
- The dashboard shows no answer content of any kind
- Cohort deletion is one action and cascades fully

## Risks

- The temptation will be to "just for now" bypass the gate during development. Use the seed script's facilitator, already submitted, instead of adding a bypass flag that survives into production.
