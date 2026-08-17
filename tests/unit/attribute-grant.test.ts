import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ATTRIBUTE_GRANT_HEADER,
  ATTRIBUTE_GRANT_TTL_MS,
  createAttributeGrant,
  verifyAttributeGrant,
  type AttributeGrantScope,
} from "../../lib/attribute-grant";

// F14-T05 — the attribute-grant signing and verification (spec.md §10
// criterion 12, ui_ux.md §4.18). The whole hardening hangs on this: the named
// payload of the comparison endpoint is served only when a signed, scoped,
// short-lived grant supplied over the header verifies against the exact
// request. Every failure mode — a missing grant, a forged signature, the wrong
// scope, an expired grant, a client-crafted token — must verify false, and a
// false grant must never serve names (the route falls back to anonymised).
// Mirrors session.ts's sign/verify pattern; the `beforeEach` pins SESSION_SECRET
// exactly as session.test.ts does.

const SECRET = "unit-test-secret";
const SCOPE: AttributeGrantScope = {
  respondentId: "20000000-0000-0000-0000-000000000001",
  cohortId: "10000000-0000-0000-0000-000000000001",
  qid: "q7",
};

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
});

describe("attribute-grant constants (F14-T05)", () => {
  it("uses a request header name, never a URL value", () => {
    expect(ATTRIBUTE_GRANT_HEADER).toBe("x-attribute-grant");
  });

  it("has a short, positive lifetime so it cannot persist across a session", () => {
    expect(ATTRIBUTE_GRANT_TTL_MS).toBeGreaterThan(0);
    expect(ATTRIBUTE_GRANT_TTL_MS).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});

describe("attribute-grant round trip (F14-T05)", () => {
  it("verifies a freshly minted grant for its own scope", () => {
    const grant = createAttributeGrant(SCOPE);
    expect(verifyAttributeGrant(grant, SCOPE)).toBe(true);
  });

  it("verifies faithfully at an explicit point in time within the TTL", () => {
    const now = Date.parse("2026-08-17T12:00:00Z");
    const grant = createAttributeGrant(SCOPE, now);
    expect(verifyAttributeGrant(grant, SCOPE, now + 60_000)).toBe(true);
  });

  it("rejects a grant for a different respondent, cohort or question", () => {
    const grant = createAttributeGrant(SCOPE);
    expect(
      verifyAttributeGrant(grant, { ...SCOPE, respondentId: "other" }),
    ).toBe(false);
    expect(
      verifyAttributeGrant(grant, { ...SCOPE, cohortId: "other" }),
    ).toBe(false);
    expect(verifyAttributeGrant(grant, { ...SCOPE, qid: "q3" })).toBe(false);
  });

  it("rejects an expired grant", () => {
    const issued = Date.parse("2026-08-17T12:00:00Z");
    const grant = createAttributeGrant(SCOPE, issued);
    // Well past the TTL — this grant is stale and must no longer authorise names.
    expect(verifyAttributeGrant(grant, SCOPE, issued + ATTRIBUTE_GRANT_TTL_MS + 1)).toBe(
      false,
    );
  });
});

describe("attribute-grant tamper and forgery resistance (F14-T05)", () => {
  it("rejects a tampered signature", () => {
    const grant = createAttributeGrant(SCOPE);
    const corrupted =
      grant.slice(0, -1) + (grant.endsWith("A") ? "B" : "A");
    expect(verifyAttributeGrant(corrupted, SCOPE)).toBe(false);
  });

  it("rejects a payload altered while the signature is untouched", () => {
    const grant = createAttributeGrant(SCOPE);
    const body = Buffer.from(
      JSON.stringify({ ...SCOPE, qid: "q99", iat: 0, exp: 1e12 }),
    ).toString("base64url");
    const forged = `${body}.${grant.split(".")[1]}`;
    expect(verifyAttributeGrant(forged, SCOPE)).toBe(false);
  });

  it("rejects a client-minted token signed with a different secret", () => {
    const body = Buffer.from(
      JSON.stringify({ ...SCOPE, iat: 0, exp: 1e12 }),
    ).toString("base64url");
    const sig = createHmac("sha256", "a-different-secret")
      .update(body)
      .digest("base64url");
    expect(verifyAttributeGrant(`${body}.${sig}`, SCOPE)).toBe(false);
    // Verification against the real secret also fails — the signature differs.
    const realSig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyAttributeGrant(`${body}.${realSig}`, SCOPE)).toBe(false);
  });

  it("rejects malformed, empty and missing grants", () => {
    expect(verifyAttributeGrant(undefined, SCOPE)).toBe(false);
    expect(verifyAttributeGrant("", SCOPE)).toBe(false);
    expect(verifyAttributeGrant("no-dot-here", SCOPE)).toBe(false);
    expect(verifyAttributeGrant("garbage.also-garbage", SCOPE)).toBe(false);
  });

  it("rejects a signed-but-shapeless payload", () => {
    const body = Buffer.from(JSON.stringify({ nope: 1 })).toString("base64url");
    const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
    expect(verifyAttributeGrant(`${body}.${sig}`, SCOPE)).toBe(false);
  });

  it("verifies false, never throws, when SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(verifyAttributeGrant("a.b", SCOPE)).toBe(false);
  });

  it("creates loudly when SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createAttributeGrant(SCOPE)).toThrow(/SESSION_SECRET/);
  });
});