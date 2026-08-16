import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionToken, parseSessionToken } from "../../lib/session";

// F02-T06 — the session middleware is the single authorisation point, and it
// never trusts a role or identity value a client can send. The 401 and
// redirect behaviour is exercised live in tests/e2e/session-middleware.spec.ts;
// what is assertable here without a request is the *shape* of the guarantee:
// the gate reads identity exclusively from the signed cookie, and a session
// cookie carries no role field at all, so is_facilitator cannot be smuggled
// into one. is_facilitator is resolved from the respondents row instead.

const authSource = () => readFileSync(resolve(process.cwd(), "lib", "auth.ts"), "utf8");
const sessionSource = () => readFileSync(resolve(process.cwd(), "lib", "session.ts"), "utf8");
const selfRouteSource = () =>
  readFileSync(
    resolve(process.cwd(), "app", "api", "respondent", "self", "route.ts"),
    "utf8",
  );

const SECRET = "unit-test-secret";
const PAYLOAD = {
  respondentId: "20000000-0000-0000-0000-000000000001",
  cohortId: "10000000-0000-0000-0000-000000000001",
};

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("F02-T06 middleware — single source of authorisation", () => {
  it("exposes the API (401) and page (claim-redirect) gates on resolveSession", () => {
    const src = authSource();
    expect(src).toMatch(/requireApiSession/);
    expect(src).toMatch(/requirePageSession/);
    expect(src).toMatch(/resolveSession/);
    expect(src).toMatch(/SESSION_COOKIE/);
  });

  it("reads the request identity only from the signed cookie", () => {
    const src = authSource();
    // The gate must not reach into the HTTP request for identity: no request
    // body parse, no header read, no query string. (NextResponse.json, used
    // only for the 401 body, is not a request read and is allowed.)
    expect(src).not.toMatch(/request\.json|req\.json/);
    expect(src).not.toMatch(/request\.headers|req\.headers/);
    expect(src).not.toMatch(/searchParams|URLSearchParams/);
    expect(src).toMatch(/cookies\(\)/);
    expect(src).toMatch(/SESSION_COOKIE/);
  });

  it("the single protected API route passes through requireApiSession", () => {
    const src = selfRouteSource();
    expect(src).toMatch(/requireApiSession/);
    // It must not inline its own resolveSession/reject decision.
    expect(src).not.toMatch(/resolveSession/);
  });
});

describe("F02-T06 — role cannot be supplied by the client", () => {
  it("a session cookie carries no role field a client could forge", () => {
    const token = createSessionToken(PAYLOAD);
    const payload = parseSessionToken(token)!;
    // The signed cookie has exactly two fields — respondent and cohort. Any
    // role claim (is_facilitator) is impossible to put there and survive
    // parsing, and even a crafted one is ignored because resolution reads the
    // flag from the database, not the cookie.
    expect(Object.keys(payload).sort()).toEqual(["cohortId", "respondentId"]);
  });

  it("is_facilitator is resolved from the respondents row, never from a request", () => {
    // The identity gate never inspects a header/body/query for a role.
    expect(authSource()).not.toMatch(/request\.json|req\.json/);
    expect(authSource()).not.toMatch(/request\.headers|req\.headers/);
    expect(authSource()).not.toMatch(/searchParams|URLSearchParams/);
    // The one place the flag exists is the DB query that reads the row.
    expect(sessionSource()).toMatch(/select r\.is_facilitator/);
    expect(sessionSource()).toMatch(/respondents r/);
  });
});