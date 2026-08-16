# F04 — Autosave, resume & offline

**Phase:** P1 · **Depends on:** F03 · **Blocks:** F06

## What this is

The trust layer. People will answer this on a phone, on mobile data, in between other things, over more than one sitting. `ui_ux.md` D4 names the single biggest trust failure available to this product: losing someone's answer. Everything in this feature exists to make that impossible and to make its impossibility visible.

Two rules carry the weight:

- **Save state is permanent, not a toast.** A message that fades cannot reassure someone who looks up ten seconds later.
- **Resume never lands at Q1.** Landing back at the start is the most common reason people abandon a half-finished form (`ui_ux.md` §3.2).

## Scope

- `PATCH /api/answers` with lock enforcement
- Debounced autosave on change and on navigation
- Persistent save-state indicator
- localStorage mirror and offline behaviour
- Sync conflict resolution
- Resume landing screen

## Exit criteria

- Killing the tab mid-answer and reopening the link loses nothing
- Airplane mode mid-questionnaire does not interrupt answering, and answers sync on reconnect
- Resume lands on the first unanswered question with a route back to any answered one

## Risks

- Conflict resolution is the subtle one. The rule is: **server wins on lock status, local wins on content, and typed text is never silently discarded.** A naive last-write-wins will eventually eat an answer.
