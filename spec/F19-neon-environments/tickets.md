# F19 — Tickets

---

## F19-T01 — Use Neon branches for preview and hosted E2E

**Phase:** M · **Depends:** F17-T03 · **Source item:** M04 · **Traces:** `EXECUTION-NEON.md` M04, `tech_infrastructure.md` §10

### Requirements

- The system SHALL document how to create, configure, and tear down an ephemeral Neon branch for the E2E suite.
- WHERE the deployment environment is `preview`, the system SHALL use a non-production Neon branch.
- WHERE hosted E2E runs against Neon, the system SHALL use an ephemeral non-production branch.
- IF an E2E database URL resolves to the production Neon branch, THEN the system SHALL stop before applying migrations or test data.
- The system SHALL keep local Docker as an environment-selected offline fallback requiring no application-code change.

### Acceptance

- [ ] E2E passes against an ephemeral Neon branch
- [ ] E2E passes against local Docker with only environment values changed
- [ ] A production-branch URL is rejected before migrations run
- [ ] Branch teardown and stale-branch cleanup are documented

---

## F19-T02 — Document the migration environment

**Phase:** M · **Depends:** F19-T01 · **Source item:** M05 · **Traces:** `EXECUTION-NEON.md` M05, `AGENTS.md`, `tech_infrastructure.md` §10

### Requirements

- The system SHALL provide `.env.example` entries for `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `GEMINI_API_KEY`, `AI_MODEL`, `AI_LEVEL_PIN`, `SESSION_SECRET`, and `RESEND_API_KEY`.
- The system SHALL identify `DATABASE_URL` as pooled and `DATABASE_URL_UNPOOLED` as direct, and SHALL show `sslmode=require` without including credentials.
- The system SHALL document a pinned Gemini model form and SHALL NOT recommend a moving alias.
- WHERE the environment is local or preview, the system SHALL keep `AI_LEVEL_PIN=L2` as the documented default.
- The system SHALL keep `.env.local` excluded from version control.
- The system SHALL retain the local Docker instructions as the offline fallback and SHALL present Neon as the hosted default.

### Acceptance

- [ ] `.env.example` lists every runtime variable and contains no usable secret
- [ ] The example distinguishes pooled and direct Neon URLs
- [ ] `.gitignore` excludes `.env.local`
- [ ] Local and preview documentation still defaults to L2
- [ ] Offline Docker verification remains documented and runnable

