import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  INVITE_TOKEN_BYTES,
} from "../../lib/invites";

// F02-T01 token generation + the no-logging guarantee, verified without a
// database. The full lifecycle (issue / resolve / revoke against Postgres) is
// covered separately by invites.integration.test.ts; this file is pure.

// 32 bytes base64url-encoded, padding stripped: charCount = ceil(32 / 3) * 4
// minus two; base64url drops the '=' padding, so 32 bytes yield 43 chars.
const TOKEN_LENGTH = 43;

describe("invite token generation (F02-T01, FR-1)", () => {
  it("is 32 random bytes encoded as base64url", () => {
    for (let i = 0; i < 100; i++) {
      const token = generateInviteToken();
      expect(token.length).toBe(TOKEN_LENGTH);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("exposes the byte count as a constant", () => {
    expect(INVITE_TOKEN_BYTES).toBe(32);
  });

  it("never yields the same token twice (two respondents never share)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const token = generateInviteToken();
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});

describe("invite tokens are never logged (F02-T01)", () => {
  it("are absent from the invites module by grep", () => {
    const source = readFileSync(resolve(process.cwd(), "lib", "invites.ts"), "utf8");
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\b(?:logger|logger\.|log\.)\b/);
  });
});