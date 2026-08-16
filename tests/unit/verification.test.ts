import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// F11-T01 acceptance: verify.sh exists at the repo root, is executable in
// version control, runs the four steps in order, aborts on the first failure,
// and never invokes an AI provider (the T1 live-model test is deliberately
// kept out of the default run, per F11-T01 and tech_infrastructure.md §8).

const ROOT = process.cwd();
const VERIFY = resolve(ROOT, "verify.sh");
const script = readFileSync(VERIFY, "utf8");

describe("verification script (F11-T01)", () => {
  it("exists at the repository root with a bash shebang", () => {
    expect(script.startsWith("#!/usr/bin/env bash")).toBe(true);
  });

  it("is executable in the working tree", () => {
    const mode = statSync(VERIFY).mode & 0o777;
    expect(mode & 0o100).toBe(0o100);
  });

  it("is tracked in git with the executable bit set", () => {
    const modeLine = execSync("git ls-files -s verify.sh", { cwd: ROOT })
      .toString()
      .trim();
    expect(modeLine).toMatch(/^100755 /);
  });

  it("aborts on the first failing step", () => {
    // `set -e` makes the script exit non-zero as soon as any step fails, so
    // later steps never run after a failure.
    expect(script).toContain("set -e");
  });

  it("runs typecheck, lint, unit tests and Playwright in that order", () => {
    const typecheck = script.indexOf("npm run typecheck");
    const lint = script.indexOf("npm run lint");
    const unit = script.indexOf("npm run test");
    const e2e = script.indexOf("npx playwright test");
    for (const index of [typecheck, lint, unit, e2e]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(lint).toBeGreaterThan(typecheck);
    expect(unit).toBeGreaterThan(lint);
    expect(e2e).toBeGreaterThan(unit);
  });

  it("never calls an AI provider, so it runs with the key absent", () => {
    // The T1 live-model coach test runs the model at L0 and is excluded from
    // the default run (F11-T01 "SHALL NOT"; tech_infrastructure.md §8).
    expect(script).not.toMatch(/ANTHROPIC|anthropic|claude|openai|\bL0\b/i);
  });
});