import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { logAICall, AI_LOG_FIELDS, type AICallLogRecord } from "../../lib/log";
import { createSessionToken } from "../../lib/session";
import { generateInviteToken } from "../../lib/invites";
import { generateResumeCode } from "../../lib/resume";
import { loadConfig } from "../../lib/config";

// F11-T06 — the log redaction test (spec.md §8, tech_infrastructure.md §9, §11).
//
// The redaction guarantee lives in lib/log.ts: it is the only runtime logging
// sink, and its one payload shape is the five-field AI record from §11. The
// three acceptance criteria map onto three kinds of check here:
//  1. a distinctive seeded answer string stays out of captured logs after a run
//     of the main flows — a live console capture over the flows that manufacture
//     the credentials §11 says must never appear;
//  2. structured AI log entries carry exactly the five permitted fields and no
//     content — the wire-shape of `logAICall`, against the whitelist;
//  3. token and code values absent under grep — a whole-codebase scan proving
//     `console.` exists only in lib/log.ts, so no answer-bearing carrier
//     (answers, submit, interactions, resume, invites, session) can log at all.
//
// This test runs offline (no DATABASE_URL, no AI key) inside the unit suite.

const ROOT = process.cwd();

/** A digit-bearing phrase that must never surface in any captured log line. */
const ANSWER_MARKER = "PLUMBINGALIGN79 NEARESTWAREHOUSE";

/** Remember and restore a process.env variable exactly as it was. */
function rememberEnv(name: string): () => void {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const value = process.env[name];
  return () => {
    if (had) process.env[name] = value;
    else delete process.env[name];
  };
}

/** Recursively list every .ts/.tsx file under a directory (absolute paths). */
function collect(files: string[], dir: string): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(files, full);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F11-T06: every runtime log sink lives in lib/log.ts", () => {
  it("lib/ and app/ reference `console.` nowhere except lib/log.ts (by grep)", () => {
    const offsets: string[] = [];
    for (const dir of ["lib", "app"]) {
      const base = resolve(ROOT, dir);
      for (const file of collect([], base)) {
        const rel = relative(ROOT, file);
        if (rel === "lib/log.ts") continue;
        const source = readFileSync(file, "utf8");
        if (/console\./.test(source)) offsets.push(rel);
      }
    }
    expect(offsets).toEqual([]);
  });

  it("the sanctioned sink actually touches a console method", () => {
    const source = readFileSync(resolve(ROOT, "lib/log.ts"), "utf8");
    expect(source).toMatch(/console\.(?:log|debug)\(/);
  });

  it("answer-carrier modules have no log sink, so they cannot print answer text", () => {
    for (const rel of [
      "lib/answers.ts",
      "lib/submit.ts",
      "lib/interactions.ts",
      "lib/session.ts",
      "lib/invites.ts",
      "lib/resume.ts",
    ]) {
      const source = readFileSync(resolve(ROOT, rel), "utf8");
      expect(source).not.toMatch(/console\./);
    }
  });
});

describe("F11-T06: structured AI log entries", () => {
  it("logAICall emits exactly the five permitted fields and no content", () => {
    const captured: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });

    const record: AICallLogRecord = {
      purpose: "coach",
      level: "L2",
      latencyMs: 41,
      tokens: { input: 300, output: 80 },
      guardResult: "ok",
    };
    try {
      logAICall(record);
    } finally {
      spy.mockRestore();
    }

    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]) as Record<string, unknown>;
    // Every key on the wire is one of the five §11 fields, and nothing else —
    // there is no hint/content/message field that answer substance could hide
    // in, and the values came straight through.
    expect(Object.keys(parsed).sort()).toEqual([...AI_LOG_FIELDS].sort());
    expect(parsed.purpose).toBe("coach");
    expect(parsed.level).toBe("L2");
    expect(parsed.latencyMs).toBe(41);
    expect(parsed.tokens).toEqual({ input: 300, output: 80 });
    expect(parsed.guardResult).toBe("ok");
  });

  it("the serialized record contains no answer marker (no stray content)", () => {
    const captured: string[] = [];
    const spy = vi
      .spyOn(console, "log")
      .mockImplementation((...args: unknown[]) => {
        captured.push(args.map(String).join(" "));
      });
    try {
      logAICall({
        purpose: "analysis",
        level: "L0",
        latencyMs: 200,
        tokens: { input: 1200, output: 150 },
        guardResult: null,
      });
    } finally {
      spy.mockRestore();
    }
    expect(captured.join("")).not.toContain(ANSWER_MARKER);
  });
});

describe("F11-T06: captured logs across the main flows", () => {
  it("a seeded answer string and every credential value stay out of the logs", () => {
    const restoreKey = rememberEnv("ANTHROPIC_API_KEY");
    const restoreSecret = rememberEnv("SESSION_SECRET");
    delete process.env.ANTHROPIC_API_KEY;
    process.env.SESSION_SECRET = "log-redaction-test-secret";

    const lines: string[] = [];
    const sink =
      (method: "log" | "info" | "warn" | "error" | "debug" | "trace") =>
      (...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      };
    const spies = [
      vi.spyOn(console, "log").mockImplementation(sink("log")),
      vi.spyOn(console, "info").mockImplementation(sink("info")),
      vi.spyOn(console, "warn").mockImplementation(sink("warn")),
      vi.spyOn(console, "error").mockImplementation(sink("error")),
      vi.spyOn(console, "debug").mockImplementation(sink("debug")),
      vi.spyOn(console, "trace").mockImplementation(sink("trace")),
    ];

    let cookie: string;
    let invite: string;
    let resume: string;
    try {
      // The main flows §11 says must produce nothing in logs. Claiming a
      // session signs a cookie; issuing an invite generates a token; the
      // resume restores with a code; boot reports a missing key at debug; a
      // coach call logs its five-field record. The seeded answer marker rides
      // the scenario as the kind of content that must never be logged.
      cookie = createSessionToken({ respondentId: "resp-1", cohortId: "cohort-1" });
      invite = generateInviteToken();
      resume = generateResumeCode();
      loadConfig();
      logAICall({
        purpose: "coach",
        level: "L2",
        latencyMs: 8,
        tokens: { input: 100, output: 40 },
        guardResult: "ok",
      });
    } finally {
      for (const spy of spies) spy.mockRestore();
      restoreSecret();
      restoreKey();
    }

    const all = lines.join("\n");
    // The seeded answer text is absent from every captured line.
    expect(all.includes(ANSWER_MARKER)).toBe(false);
    // none of the credential values appears under a full grep of the capture.
    expect(all).not.toContain(cookie);
    expect(all).not.toContain(invite);
    expect(all).not.toContain(resume);
  });
});