import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decideResumeAttempt,
  emailResumeCode,
  generateResumeCode,
  isValidResumeCode,
  normalizeResumeCode,
  RESUME_ALPHABET,
  RESUME_CODE_LENGTH,
  RESUME_MAX_ATTEMPTS,
} from "../../lib/resume";

// F02-T03 resume codes, verified without a database. Generation (the
// unambiguous alphabet), case-insensitive normalisation, the pure rate-limit
// decision, and the "email failure never blocks" guarantee are all pure and
// testable here; the Postgres halves (storing/reading attempts, resolving a
// code, assigning on first save) live in resume.integration.test.ts.

const HOUR = 60 * 60 * 1000;

function at(ms: number): Date {
  return new Date(ms);
}

describe("resume code generation (F02-T03)", () => {
  it("draws from 32 symbols that exclude O, 0, I and 1", () => {
    expect(RESUME_ALPHABET.length).toBe(32);
    for (const ch of RESUME_ALPHABET) {
      expect(["O", "0", "I", "1"].includes(ch)).toBe(false);
    }
  });

  it("produces six-character codes from only the unambiguous alphabet", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateResumeCode();
      expect(code.length).toBe(RESUME_CODE_LENGTH);
      for (const ch of code) {
        expect(RESUME_ALPHABET.includes(ch)).toBe(true);
      }
    }
  });

  it("never yields the same code twice", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const code = generateResumeCode();
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
  });

  it("every generated code is valid under the validity check", () => {
    for (let i = 0; i < 500; i++) {
      expect(isValidResumeCode(generateResumeCode())).toBe(true);
    }
  });
});

describe("resume code case-insensitivity (F02-T03)", () => {
  it("normalises to uppercase", () => {
    expect(normalizeResumeCode("abcdef")).toBe("ABCDEF");
    expect(normalizeResumeCode("AbCdEf")).toBe("ABCDEF");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeResumeCode("  ABCDEF  ")).toBe("ABCDEF");
  });

  it("a valid code is valid in either case", () => {
    const code = generateResumeCode();
    expect(isValidResumeCode(code.toLowerCase())).toBe(true);
    expect(isValidResumeCode(code)).toBe(true);
  });
});

describe("resume code validity (F02-T03)", () => {
  it("rejects codes containing a disallowed character", () => {
    expect(isValidResumeCode("ABCDEO")).toBe(false);
    expect(isValidResumeCode("ABCDE0")).toBe(false);
    expect(isValidResumeCode("ABCDEI")).toBe(false);
    expect(isValidResumeCode("ABCDE1")).toBe(false);
  });

  it("rejects codes of the wrong length", () => {
    expect(isValidResumeCode("ABC")).toBe(false);
    expect(isValidResumeCode("ABCDEFG")).toBe(false);
    expect(isValidResumeCode("")).toBe(false);
  });

  it("rejects symbols outside the alphabet", () => {
    expect(isValidResumeCode("ABCDE*")).toBe(false);
    expect(isValidResumeCode("ABCDE-")).toBe(false);
  });
});

describe("resume-code rate limit (F02-T03)", () => {
  const now = at(1_000_000_000_000);

  it("allows the first five attempts within the hour", () => {
    const attempts = [0, 1, 2, 3].map((i) => at(now.getTime() - i * 1000));
    expect(decideResumeAttempt([], now).reject).toBe(false);
    expect(decideResumeAttempt(attempts, now).reject).toBe(false);
    expect(decideResumeAttempt(attempts, now)).toEqual({
      reject: false,
      retryAfterMs: null,
    });
  });

  it("rejects the 6th attempt within the hour", () => {
    const attempts = [0, 1, 2, 3, 4].map((i) => at(now.getTime() - i * 1000));
    expect(RESUME_MAX_ATTEMPTS).toBe(5);
    expect(decideResumeAttempt(attempts, now).reject).toBe(true);
  });

  it("ignores attempts older than the rolling hour", () => {
    // Five attempts, but four of them fall outside the hour, so only one counts.
    const attempts = [
      at(now.getTime() - HOUR - 1),
      at(now.getTime() - HOUR - 2),
      at(now.getTime() - HOUR - 3),
      at(now.getTime() - HOUR - 4),
      at(now.getTime() - 1000),
    ];
    expect(decideResumeAttempt(attempts, now).reject).toBe(false);
  });

  it("reports a retry-after until the window no longer holds five", () => {
    const oldest = at(now.getTime() - 10 * 1000);
    const attempts = [0, 1, 2, 3].map((i) => at(now.getTime() - i * 1000));
    attempts.push(oldest);
    const decision = decideResumeAttempt(attempts, now);
    expect(decision.reject).toBe(true);
    // Reject until the oldest attempt ages out of the window.
    expect(decision.retryAfterMs).toBe(oldest.getTime() + HOUR - now.getTime());
  });
});

describe("emailing the resume code is never blocking (F02-T03)", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
  });
  afterEach(() => {
    delete process.env.RESEND_API_KEY;
  });

  it("sends through the injected sender when the key is present", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    let received: { to: string; payload: { html: string } } | null = null;
    const result = await emailResumeCode(
      "ABCDEF",
      "ana@anakloud.ph",
      async (to, payload) => {
        received = { to, payload };
        return true;
      },
    );
    expect(result.sent).toBe(true);
    expect(received!.to).toBe("ana@anakloud.ph");
    expect(received!.payload.html).toContain("ABCDEF");
  });

  it("returns { sent: false } without throwing when a sender throws", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const throwingSender = async () => {
      throw new Error("resend is down");
    };
    await expect(
      emailResumeCode("ABCDEF", "ana@anakloud.ph", throwingSender),
    ).resolves.toEqual({ sent: false });
  });

  it("returns { sent: false } without throwing when a sender reports failure", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const result = await emailResumeCode("ABCDEF", "ana@anakloud.ph", async () => false);
    expect(result).toEqual({ sent: false });
  });

  it("never attempts a network call when no RESEND_API_KEY is set", async () => {
    // The default sender short-circuits on a missing key, so this resolves
    // locally with no network touch and no throw.
    delete process.env.RESEND_API_KEY;
    await expect(
      emailResumeCode("ABCDEF", "ana@anakloud.ph"),
    ).resolves.toEqual({ sent: false });
  });
});

describe("resume codes are never logged (F02-T03)", () => {
  it("the resume module makes no logging calls (by grep)", () => {
    const source = readFileSync(resolve(process.cwd(), "lib", "resume.ts"), "utf8");
    expect(source).not.toMatch(/console\./);
    expect(source).not.toMatch(/\b(?:logger|logger\.|log\.)\b/);
  });
});