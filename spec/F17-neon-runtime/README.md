# F17 — Neon runtime

**Phase:** M · **Depends on:** F01 · **Blocks:** F19, F20

## What this is

The production database transport for Neon. Request traffic uses Neon's pooled endpoint, while migrations use the direct endpoint because `pg_advisory_lock` is session-scoped and cannot safely span transactions through a transaction pooler.

The database boundary remains `lib/db.ts`. Request code keeps calling `createDbClient()` and RLS keeps its transaction-local `set_config(..., true)` behaviour. This feature implements source migration items M01–M03.

## Scope

- Separate pooled request and direct migration connection strings
- Select the Neon serverless driver behind the existing database boundary
- Preserve query and transaction behaviour expected by current callers
- Audit success and error paths for connection release
- Measure connection use under representative load

## Exit criteria

- Concurrent migrations serialise through the direct Neon endpoint
- Request routes work through the pooled endpoint with required TLS
- No request leaks a checked-out connection on success or failure
- The E2E connection count remains within the selected Neon plan's limit

## Risks

- **Advisory locking can fail silently through a transaction pooler.** Migration URL selection needs a direct test.
- Per-request TLS handshakes can turn every route into a latency regression; driver choice and lifecycle verification belong in the same feature.

