# F02 — Invite, session & onboarding

**Phase:** P1 · **Depends on:** F01 · **Blocks:** F03, F09

## What this is

Getting six known people into the questionnaire with no password, and setting their expectations before they answer a single question.

Two things here are load-bearing and easy to get wrong:

- **The link is the credential.** There is no signup, no password, no OAuth. That is a deliberate simplification for a cohort of six, and it means token handling has to be right: 32 random bytes, exchanged once for an httpOnly cookie, revocable per person.
- **The ground-rules screen is not boilerplate.** It is the mechanism that makes people answer honestly rather than diplomatically. It cannot be skipped (`ui_ux.md` §4.2).

## Scope

- Invite token issue and revoke
- `/api/session/claim` — token or resume code in, session cookie out
- Resume codes, with rate limiting
- Welcome / name entry
- Ground rules gate
- Session middleware and role resolution

## Exit criteria

- A fresh invite link lands on name entry; a used one restores the session
- A resume code restores the session from a different device
- Ground rules cannot be bypassed by navigating directly to `/q/1`
- Six links can be issued and one revoked without touching the database by hand

## Risks

- Rate limiting on resume codes is the only brute-force surface in the product. 6 characters from a 32-symbol alphabet is fine at 5 attempts/hour and indefensible without it.
- Copy on these two screens is a feature (`ui_ux.md` §8). Do not rewrite it into survey-platform voice.
