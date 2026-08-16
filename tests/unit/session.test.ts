import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  sessionCookieOptions,
  parseSessionToken,
  SESSION_COOKIE,
} from "../../lib/session";

// F02-T02 session signing, verified without a database. The cookie attributes
// (httpOnly, SameSite=Lax, no Max-Age) and the sign/verify round trip are the
// pure, testable heart of "exchange the invite token for a session cookie";
// the database half — resolveSession resolving an open vs a closed cohort —
// lives in session.integration.test.ts against a real Postgres.

const SECRET = "unit-test-secret";
const PAYLOAD = { respondentId: "20000000-0000-0000-0000-000000000001", cohortId: "10000000-0000-0000-0000-000000000001" };

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("session cookie attributes (F02-T02)", () => {
  it("is httpOnly", () => {
    expect(sessionCookieOptions().httpOnly).toBe(true);
  });

  it("is SameSite=Lax", () => {
    expect(sessionCookieOptions().sameSite).toBe("lax");
  });

  it("sets a scoped path", () => {
    expect(sessionCookieOptions().path).toBe("/");
  });

  it("sets no Max-Age or Expires — the session survives the cohort", () => {
    // F02-T02: "SHALL NOT expire a session while the cohort is open". A session
    // cookie with no TTL cannot expire mid-questionnaire of its own accord.
    const options = sessionCookieOptions();
    expect("maxAge" in options).toBe(false);
    expect("expires" in options).toBe(false);
  });

  it("has a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("align_session");
  });
});

describe("session signing and verification (F02-T02)", () => {
  it("round-trips a signed session back to its payload", () => {
    const token = createSessionToken(PAYLOAD);
    expect(parseSessionToken(token)).toEqual(PAYLOAD);
  });

  it("contains both the respondent and cohort ids", () => {
    const token = createSessionToken(PAYLOAD);
    const parsed = parseSessionToken(token)!;
    expect(parsed.respondentId).toBe(PAYLOAD.respondentId);
    expect(parsed.cohortId).toBe(PAYLOAD.cohortId);
  });

  it("returns null for a tampered cookie", () => {
    const token = createSessionToken(PAYLOAD);
    // Deterministically corrupt the final signature character. base64url has
    // 64 symbols, so replacing it with a fixed different character cannot come
    // out identical, and any change to the HMAC fails verification.
    const corrupted = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(parseSessionToken(corrupted)).toBeNull();
  });

  it("returns null when the payload is altered", () => {
    // Flip a character inside the body while leaving the signature untouched —
    // indistinguishable from client tampering, and it must fail the check.
    const token = createSessionToken(PAYLOAD).split(".");
    const body = Buffer.from(
      JSON.stringify({
        ...PAYLOAD,
        respondentId: "99999999-9999-9999-9999-999999999999",
      }),
    ).toString("base64url");
    const forged = `${body}.${token[1]}`;
    expect(parseSessionToken(forged)).toBeNull();
  });

  it("returns null when verified against a different secret", () => {
    const token = createSessionToken(PAYLOAD);
    process.env.SESSION_SECRET = "a-different-secret";
    expect(parseSessionToken(token)).toBeNull();
  });

  it("returns null for a malformed value", () => {
    expect(parseSessionToken(undefined)).toBeNull();
    expect(parseSessionToken("")).toBeNull();
    expect(parseSessionToken("no-dot-here")).toBeNull();
    expect(parseSessionToken("a.b-but-not-json-or-verified")).toBeNull();
  });

  it("rejects a signed-but-shapeless payload", () => {
    // A body that is valid JSON over the wrong shape still fails.
    const body = Buffer.from(JSON.stringify({ nope: 1 })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(parseSessionToken(`${body}.${sig}`)).toBeNull();
  });

  it("throws loudly when SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createSessionToken(PAYLOAD)).toThrow(/SESSION_SECRET/);
    expect(() => parseSessionToken("a.b")).toThrow(/SESSION_SECRET/);
  });
});

describe("session values are never logged (F02-T02)", () => {
  it("the session module makes no logging calls (by grep)", () => {
    const source = readFileSync(resolve(process.cwd(), "lib", "session.ts"), "utf8");
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\b(?:logger|logger\.|log\.)\b/);
  });

  it("the claim route makes no logging calls (by grep)", () => {
    const source = readFileSync(
      resolve(process.cwd(), "app", "api", "session", "claim", "route.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\b(?:logger|logger\.|log\.)\b/);
  });
});