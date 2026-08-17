# Execution plan — Neon + Gemini migration

**Scope:** replace containerised Postgres with Neon, and replace the Anthropic provider with the Gemini API.
**Phase:** M (post-P4) · **Tickets:** M01 – M12
**Traces:** `tech_infrastructure.md` §1, §3, §5, §6, §9, §10; PR3, PR6

---

## Feature implementation map

The source migration items below are implemented through the repository's normal feature and ticket structure. The source IDs remain on every ticket for traceability.

| Feature | Source items | Purpose |
|---|---|---|
| [F16 — Gemini configuration guardrails](F16-gemini-configuration-guardrails/) | M09, M10, M11 | Retarget model, key-leak, and no-key guards before the provider changes |
| [F17 — Neon runtime](F17-neon-runtime/) | M01, M02, M03 | Pooled/direct URLs, driver boundary, and connection lifecycle |
| [F18 — Gemini provider](F18-gemini-provider/) | M06, M07, M08 | Transport, schema fidelity, and safety-block degradation |
| [F19 — Neon environments](F19-neon-environments/) | M04, M05 | Preview/test branches, offline fallback, and environment docs |
| [F20 — Migration release gate](F20-migration-release-gate/) | M12 | Gemini containment and final no-key verification |

Implementation order is F16 first; F17 and F18 may then proceed independently; F19 follows F17; F20 is last.

---

## Why this is small, and where it isn't

Two boundaries in the build make most of this cheap:

- **`lib/db.ts` is the only module that constructs a Postgres client.** 77 files call `createDbClient()` and none of them know what is behind it. Neon lands in one file.
- **`lib/provider.ts` is the only module that talks to a model vendor**, and a scan test enforces that nothing but the gateway imports it. The `AIProvider` interface is already vendor-neutral — `{ prompt, model, maxTokens, structuredOutput } → { text, inputTokens, outputTokens, model }`. Gemini is a second implementation behind the same interface, not a rewrite.

The parts that are *not* cheap are the four places where a vendor difference leaks past those boundaries. Each has its own ticket below and each is a correctness issue rather than a plumbing one:

| Leak | Consequence if missed |
|---|---|
| `pg_advisory_lock` in migrations is **session-scoped** | Silently broken migrations under Neon's transaction pooler |
| `AI_MODEL_ALIAS_PATTERN` only matches whole strings | `gemini-flash-latest` passes the pinned-model check |
| `AI_KEY_ENV` is hard-coded to `ANTHROPIC_API_KEY` | The build-time key-leak guard (F11-T05) becomes vacuous |
| Gemini can refuse on safety grounds | A new failure mode with no Anthropic equivalent, on candid founder answers |

---

## Part 1 — Neon

### M01 — Two connection strings, not one

**Traces:** `tech_infrastructure.md` §3; F01-T02

Neon exposes a **pooled** endpoint (`...-pooler.<region>.aws.neon.tech`, PgBouncer in transaction mode) and a **direct** endpoint. This build needs both, because it uses both kinds of connection:

- `lib/access.ts` sets RLS context with `set_config('app.respondent_id', $1, true)` — `is_local = true`, so it is **transaction-scoped**. This is pooler-safe, and it was written that way deliberately ("a reused connection never leaks context"). All request traffic can use the pooled endpoint.
- `lib/migrate.ts` holds `pg_advisory_lock(hashtext('align_migrations'))` across the inner per-migration transactions, relying on the lock being **session-held**. Under transaction pooling the lock and its release can land on different backends. Migrations must use the **direct** endpoint.

#### Requirements

- The system SHALL read `DATABASE_URL` for request-path connections and SHALL point it at the pooled endpoint.
- The system SHALL read `DATABASE_URL_UNPOOLED` for migrations and SHALL point it at the direct endpoint.
- IF `DATABASE_URL_UNPOOLED` is unset, THEN migrations SHALL fall back to `DATABASE_URL` and SHALL log a warning that advisory locking is unreliable on a pooled endpoint.
- The system SHALL require `sslmode=require` on both.
- The system SHALL NOT change the `set_config(..., true)` call in `lib/access.ts`; transaction-scoped is correct and is what makes pooling safe.

#### Acceptance

- [ ] `npm run db:seed` (which runs migrations) succeeds against the direct endpoint
- [ ] Two concurrent migration runs serialise rather than racing
- [ ] Request-path routes work against the pooled endpoint
- [ ] A test asserts `lib/migrate.ts` resolves the unpooled URL when present

---

### M02 — Neon driver selection

**Traces:** `tech_infrastructure.md` §1

The app opens and closes a connection **per request** — `createDbClient()` then `connect()` then `end()`, in 77 files. On a local socket that costs nothing. Against Neon over TLS it is a full handshake on every request, which is the single biggest latency change in this migration.

Two options, and the choice depends on where this deploys:

| Option | When | Cost |
|---|---|---|
| `pg` against the pooled endpoint | Long-lived Node process (a container, `next start`) | Keep `pg`; no dependency change |
| `@neondatabase/serverless` | Vercel serverless / edge | One dependency; `Pool` is drop-in API-compatible with `pg` |

`tech_infrastructure.md` §1 names Vercel as the host, so `@neondatabase/serverless` is the expected path.

#### Requirements

- The system SHALL confine the driver choice to `lib/db.ts`.
- The system SHALL keep the exported signature of `createDbClient()` unchanged, so no calling module is edited.
- WHERE the serverless driver is used, the system SHALL configure it so `query` and transaction semantics match the `pg` behaviour the 77 call sites already assume.
- The system SHALL NOT add a second database dependency alongside whichever is chosen.

#### Acceptance

- [ ] `./verify.sh` green with no changes outside `lib/db.ts` and `package.json`
- [ ] A grep confirms no calling module imports a driver directly
- [ ] Connection count under a full E2E run stays within the Neon plan's limit

---

### M03 — Connection lifecycle review

**Traces:** `tech_infrastructure.md` §2

#### Requirements

- The system SHALL ensure every `createDbClient()` call site releases its connection on both the success and the error path.
- IF a request throws between `connect()` and `end()`, THEN the connection SHALL still be released.
- The system SHALL NOT introduce a module-level long-lived client that survives across serverless invocations without pooling.

#### Acceptance

- [ ] A leak test runs 200 sequential requests and shows no growth in Neon's active-connection count
- [ ] Every call site's `end()` sits in a `finally`

---

### M04 — Neon branching for preview and test

**Traces:** `tech_infrastructure.md` §10

Neon branches replace the Docker container the E2E suite currently uses (`anakloud-e2e-pg` on port 5435).

#### Requirements

- The system SHALL provide a documented way to point the E2E suite at an ephemeral Neon branch.
- WHERE the environment is `preview`, the system SHALL use a branch rather than the production database.
- The system SHALL keep the local Docker path working as an offline fallback, because a developer without network access must still be able to run `./verify.sh`.
- The system SHALL NOT run the E2E suite against the production branch under any configuration.

#### Acceptance

- [ ] E2E passes against a Neon branch
- [ ] E2E still passes against local Docker with no code change, only env
- [ ] Branch teardown is documented

---

### M05 — Retire the Docker default from local docs

**Traces:** `AGENTS.md`, `tech_infrastructure.md` §10

#### Requirements

- The system SHALL document the Neon connection strings in `.env.example`.
- The system SHALL keep `AI_LEVEL_PIN=L2` as the local and preview default (`tech_infrastructure.md` §10) — unchanged by this migration.
- The system SHALL NOT commit a Neon connection string; they carry credentials.

#### Acceptance

- [ ] `.env.example` exists, lists every variable, and contains no secret values
- [ ] `.gitignore` still excludes `.env.local`

---

## Part 2 — Gemini

### M06 — The Gemini provider

**Traces:** `tech_infrastructure.md` §5.1, §5.3; F12-T01, F13-T01

A second implementation of `AIProvider` in `lib/provider.ts`. The gateway does not change.

Mapping from the Anthropic implementation:

| Concern | Anthropic (current) | Gemini |
|---|---|---|
| Endpoint | `POST /v1/messages` | `POST /v1beta/models/{model}:generateContent` |
| Auth | `x-api-key` header | `x-goog-api-key` header |
| System prompt | `body.system` | `systemInstruction.parts[].text` |
| User turn | `messages[]` | `contents[].parts[].text` |
| Output cap | `max_tokens` | `generationConfig.maxOutputTokens` |
| Forced structure | `tools[]` + `tool_choice` | `tools[].functionDeclarations[]` + `toolConfig.functionCallingConfig.mode = "ANY"` |
| Structured result | `content[].input` on the `tool_use` block | `candidates[].content.parts[].functionCall.args` |
| Token counts | `usage.input_tokens` / `output_tokens` | `usageMetadata.promptTokenCount` / `candidatesTokenCount` |

#### Requirements

- The system SHALL implement `geminiProvider(apiKey)` returning the existing `AIProvider` interface.
- The system SHALL send the API key in the `x-goog-api-key` header and SHALL NOT place it in a query string, because URLs reach logs and proxies (`spec.md` §8).
- The system SHALL serialise a structured result to `ProviderResponse.text` as JSON, exactly as the Anthropic implementation does, so the output guard continues to scan it unchanged.
- The system SHALL map a non-2xx response to `ProviderHttpError` carrying the real status, so the gateway's retry policy (429/503 only) keeps working.
- The system SHALL populate `inputTokens` and `outputTokens` from `usageMetadata`, because budget accounting (F12-T04) is keyed on them.
- The system SHALL keep the call inside the existing 6-second timeout.
- The system SHALL NOT add an SDK dependency; `fetch` is sufficient, as it was for Anthropic.

#### Acceptance

- [ ] Faked-transport unit tests cover: structured call, plain call, 429, 503, 500, network failure, malformed body
- [ ] Token counts are non-zero on a served L0 call
- [ ] The gateway's own tests pass unmodified against the new provider

---

### M07 — Schema dialect translation

**Traces:** F13-T01; `tech_infrastructure.md` §5.3

Gemini's `functionDeclarations` take a **subset of OpenAPI 3.0 Schema**, not full JSON Schema. The coach tool's `input_schema` may use keywords Gemini rejects or silently ignores — `additionalProperties` among them. A silently-ignored constraint is the dangerous case: the call succeeds and the structural guarantee is gone.

#### Requirements

- The system SHALL express the coach's `{verdict, dimension, hint, example}` schema in a form Gemini accepts without dropping constraints.
- The system SHALL constrain `verdict` to `ok | needs_work` and `dimension` to the four named dimensions using enum support.
- IF the response cannot be parsed into the declared shape, THEN the system SHALL treat it as a provider failure and degrade, and SHALL NOT pass a partially-parsed object to the guard.
- The system SHALL assert schema fidelity in a test rather than by inspection.

#### Acceptance

- [ ] A test sends a deliberately non-conforming model reply and confirms it degrades rather than reaching the browser
- [ ] Enum constraints are enforced by the API, verified against the live endpoint once
- [ ] The parsed shape is identical to what the Anthropic path produced

---

### M08 — Safety-block handling

**Traces:** PR6; `spec.md` §7; F13-T04

**This failure mode has no Anthropic equivalent in the current build.** Gemini can return a candidate with `finishReason: "SAFETY"`, or block the prompt outright via `promptFeedback.blockReason`, producing a 200 response with no usable content.

The coach evaluates candid answers about co-founders, commitment and money — Q13 asks people to write how the company died, Q14(d) asks what would make them walk away. Content filters and candour are in tension here.

#### Requirements

- WHEN a response carries a safety finish reason or a prompt block, the system SHALL treat it as a provider failure and serve the deterministic L2 verdict.
- The system SHALL record the block distinctly from an HTTP error in `ai_interactions`, so a rising count is visible.
- The system SHALL NOT retry a safety block; the input will not change.
- The system SHALL NOT surface any indication of a block to the respondent (PR6).
- The system SHALL NOT relax safety settings as a workaround without an explicit decision recorded here.

#### Acceptance

- [ ] A faked safety-blocked response yields a normal-looking L2 coach card
- [ ] The block is logged and counted separately from guard trips and HTTP errors
- [ ] No retry is issued
- [ ] Q13 and Q14(d) fixtures are included in the T1 containment run

---

### M09 — Alias rejection for Gemini model names

**Traces:** F01-T06; `tech_infrastructure.md` §10

`AI_MODEL_ALIAS_PATTERN` is `/^(latest|newest|...)$/i` — anchored to the whole string. It rejects `latest` and accepts `gemini-flash-latest`. Verified:

```
accepted   gemini-flash-latest
accepted   gemini-2.5-flash-latest
REJECTED   latest
```

Gemini's moving aliases are **suffixes**, so the pinned-model rule is currently unenforced for every realistic Gemini name. That rule exists because a silent model change alters coach behaviour mid-cohort and invalidates the contamination audit.

#### Requirements

- The system SHALL reject an `AI_MODEL` value ending in `-latest`, `-preview`, or any other non-pinned suffix, in addition to the existing whole-string aliases.
- The system SHALL reject a bare family name that carries no version (for example `gemini-2.5-flash` where a dated or numbered pin exists).
- IF `AI_MODEL` is rejected, THEN the system SHALL throw at boot, as it does today.
- The system SHALL document the accepted pinned form in `.env.example`.

#### Acceptance

- [ ] `gemini-flash-latest` and `gemini-2.5-flash-latest` are both rejected
- [ ] A pinned dated id is accepted
- [ ] The existing whole-string alias cases still fail
- [ ] `tests/unit/config.test.ts` extended with the suffix cases

---

### M10 — Key-leak guard retargeting

**Traces:** F11-T05; `spec.md` §8

`lib/client-bundle-check.ts` hard-codes `AI_KEY_ENV = "ANTHROPIC_API_KEY"`. It scans `.next/static` for that env name and for the key's value. Point the app at Gemini without changing this and the build-time guard scans for a variable nothing uses — it passes, and it proves nothing.

#### Requirements

- The system SHALL scan the client bundle for the Gemini key's env name **and** its value.
- The system SHALL continue to fail the build on any hit.
- The system SHALL cover every AI key env name in use, not only the current one, so a leftover reference is still caught.
- The system SHALL update `tests/unit/client-bundle-check.test.ts` to assert against the new name.

#### Acceptance

- [ ] Deliberately referencing the Gemini key in a client component fails the build
- [ ] The test suite fails if `AI_KEY_ENV` is pointed at an unused variable
- [ ] `npm run build` still runs the check

---

### M11 — Environment variable rename

**Traces:** F01-T01, F01-T06, F11-T02; `tech_infrastructure.md` §10

`ANTHROPIC_API_KEY` appears in config, six API routes, the containment script, the bundle check, and — importantly — the **T2 key-removal gate**, which is documented as `env -u ANTHROPIC_API_KEY npx playwright test`.

#### Requirements

- The system SHALL rename the AI key variable to `GEMINI_API_KEY` across config, routes, scripts and tests.
- The variable SHALL remain optional; its absence SHALL remain non-fatal and SHALL NOT log above `debug` (PR3).
- The system SHALL update the T2 command in `AGENTS.md` and `spec/F11-release-gates/` to unset the new name.
- The system SHALL update `docs/tech_infrastructure.md` §10's variable list, marking the change as a deviation from the source doc with a dated note.
- IF both the old and new variables are set, THEN the system SHALL use the new one and SHALL NOT silently prefer the stale one.

#### Acceptance

- [ ] `grep -r ANTHROPIC_API_KEY` returns only historical references in `spec/` and `docs/`, each annotated
- [ ] `env -u GEMINI_API_KEY npx playwright test` passes the full journey — **this is the gate on the migration**
- [ ] Booting with the key unset produces no output above `debug`

---

### M12 — Re-run the containment gate

**Traces:** F11-T04; `spec.md` §10 criterion 8; `tech_infrastructure.md` §8 (T1)

T1 asserts the coach never supplies a domain-specific noun. It was verified against Anthropic's model behaviour under a prompt written for that model. **A different model under the same prompt is a different behavioural distribution, and the result does not carry over.**

#### Requirements

- The system SHALL re-run the 30-fixture containment test against Gemini at L0.
- The system SHALL assert zero banned terms in any hint or example, zero digits in any hint, and no hint over 25 words.
- IF the containment rate is worse than the Anthropic baseline, THEN the prompt SHALL be tightened and the run repeated, and the migration SHALL NOT be considered complete.
- The system SHALL record the guard-trip count from the run, because that is the metric that says whether the coach is leaking (`tech_infrastructure.md` §11).
- The system SHALL keep the containment run out of the default `./verify.sh`.

#### Acceptance

- [ ] Containment run passes against Gemini
- [ ] Guard-trip count recorded and compared with the Anthropic baseline
- [ ] Q13 and Q14(d) fixtures included (see M08)

---

## Order of work

M09, M10 and M11 are the guard-rails and are cheap. Do them **before** M06, so the alias check, the leak scan and the key-removal gate are already pointing at Gemini when the provider lands. Otherwise the first Gemini commit lands with three safety nets silently disabled.

```
M09 → M10 → M11        guards retargeted first
M01 → M02 → M03        Neon, one file at a time
M06 → M07 → M08        the provider and its two vendor-specific hazards
M04 → M05              environments and docs
M12                    the gate
```

M01–M05 and M06–M08 are independent; either half can ship alone.

---

## What does not change

Worth stating, because the temptation during a migration is to touch more than necessary:

- **The degradation ladder.** L0–L3, the circuit breaker, budget caps, timeout and retry policy are all provider-agnostic and stay as built.
- **The output guard.** It scans `ProviderResponse.text`. Both providers serialise structured output into that field, so the guard does not know a migration happened — which is the point of putting it after the boundary.
- **`lib/validators.ts` and `lib/static-hints.ts`.** Deterministic, no I/O, no vendor. L2 behaviour is identical before and after.
- **The RLS `set_config(..., true)` call.** Transaction-scoped, pooler-safe, already correct.
- **The 77 `createDbClient()` call sites.**

## Risks

- **The advisory lock is the one that bites silently.** A migration run against a pooled endpoint may appear to succeed while providing no mutual exclusion. It will only show up when two deploys race, which is exactly when you can least afford it. M01 is the whole mitigation.
- **Per-request connect/end against a network database** is a latency regression on every route, not just AI ones. M02 and M03 bound it; measure before and after rather than assuming.
- **T1 containment does not transfer between models.** Treat M12 as a real gate, not a formality — a coach that leaks domain nouns contaminates the baseline invisibly, and the whole product exists to measure six uncontaminated opinions.
