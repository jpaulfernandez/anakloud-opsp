# F17 — Tickets

---

## F17-T01 — Separate pooled and direct connections

**Phase:** M · **Depends:** F01-T02 · **Source item:** M01 · **Traces:** `EXECUTION-NEON.md` M01, `tech_infrastructure.md` §3

### Requirements

- The system SHALL read `DATABASE_URL` for request-path connections to the Neon pooled endpoint.
- The system SHALL read `DATABASE_URL_UNPOOLED` for migrations to the Neon direct endpoint.
- IF `DATABASE_URL_UNPOOLED` is absent, THEN the migration command SHALL fall back to `DATABASE_URL` and SHALL warn that advisory locking is unreliable through a pooled endpoint.
- The system SHALL require `sslmode=require` on both Neon connection strings.
- The system SHALL NOT change the transaction-local `set_config('app.respondent_id', $1, true)` call in `lib/access.ts`.

### Acceptance

- [ ] A unit test proves migration URL resolution prefers `DATABASE_URL_UNPOOLED`
- [ ] A unit test proves the fallback selects `DATABASE_URL` and emits the advisory-lock warning
- [ ] `npm run db:seed` succeeds through the direct endpoint
- [ ] Two concurrent migration runs serialise instead of racing
- [ ] Request-path routes pass against the pooled endpoint

---

## F17-T02 — Use the Neon serverless driver behind the database boundary

**Phase:** M · **Depends:** F17-T01 · **Source item:** M02 · **Traces:** `EXECUTION-NEON.md` M02, `tech_infrastructure.md` §1

### Requirements

- The system SHALL confine database-driver construction to `lib/db.ts`.
- The system SHALL keep the exported `createDbClient()` calling contract unchanged.
- WHERE the application runs on Vercel serverless, the system SHALL use `@neondatabase/serverless` with query and transaction semantics matching the behaviour current call sites require.
- The system SHALL remove the replaced runtime database dependency and SHALL NOT ship two production database drivers.
- The system SHALL NOT edit calling modules solely to select a database driver.

### Acceptance

- [ ] `./verify.sh` passes after the driver change
- [ ] A source scan confirms no application module imports a database driver outside `lib/db.ts`
- [ ] Dependency review confirms only the selected production driver remains
- [ ] A full E2E run stays within the Neon plan's connection limit

---

## F17-T03 — Guarantee connection release

**Phase:** M · **Depends:** F17-T02 · **Source item:** M03 · **Traces:** `EXECUTION-NEON.md` M03, `tech_infrastructure.md` §2

### Requirements

- The system SHALL release every connection obtained through `createDbClient()` on both success and failure paths.
- IF a request throws after connecting, THEN the system SHALL release the connection before the request finishes.
- WHERE a call site owns a connection lifecycle, the system SHALL place its release in a `finally` path.
- The system SHALL NOT introduce an unpooled module-level client that survives across serverless invocations.
- The system SHALL provide an automated connection-leak test using repeated requests.

### Acceptance

- [ ] A source scan or structural test verifies every owned connection has a `finally` release path
- [ ] Injected failures between connect and completion release the connection
- [ ] Two hundred sequential requests produce no upward trend in active Neon connections
- [ ] Existing transaction and RLS integration tests remain green

