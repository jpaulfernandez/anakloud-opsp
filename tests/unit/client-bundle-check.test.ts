import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SCAN_AI_KEY_ENVS,
  CLIENT_BUNDLE_DIR,
  findBundleViolations,
  keyNeedles,
} from "../../lib/client-bundle-check";
import { AI_KEY_ENV_NAMES } from "../../lib/config";

// F11-T05 — build-time guard that no AI key reaches a client bundle, retargeted
// by F16-T02 to scan both the incoming Gemini key and the legacy Anthropic key
// for the migration window. Acceptance criteria: (1) deliberately referencing
// GEMINI_API_KEY in a client component fails the build, (2) placing its value
// in client output fails the build, (3) a stale ANTHROPIC_API_KEY reference
// still fails the build, (4) the unit suite fails when an active AI key
// variable is omitted from the scan targets, and (5) the check is part of the
// standard build. The detection half is unit-tested here against a synthetic
// client-bundle directory and, for the actual exit-code behaviour, by running
// the check script against such a directory; the wiring half is asserted
// against package.json.

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "client-bundle-check-"));
  dirs.push(dir);
  return dir;
}
function write(dir: string, name: string, content: string): void {
  const full = join(dir, name);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("F11-T05: client bundle key scan", () => {
  it("flags a client file that references the GEMINI_API_KEY env name (F16-T02)", () => {
    const dir = tempDir();
    write(dir, "app.js", "const k = process.env.GEMINI_API_KEY;");
    const violations = findBundleViolations(dir, keyNeedles({}));
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("app.js");
    expect(violations[0].needle).toBe("GEMINI_API_KEY");
  });

  it("flags a client file that carries the GEMINI_API_KEY value (F16-T02)", () => {
    const dir = tempDir();
    const secret = "sk-gemini-synthetic-secret-abc123";
    write(dir, "chunk.js", `const key = "${secret}";`);
    const violations = findBundleViolations(
      dir,
      keyNeedles({ GEMINI_API_KEY: secret }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].needle).toBe(secret);
  });

  it("still flags a stale ANTHROPIC_API_KEY reference (F16-T02)", () => {
    const dir = tempDir();
    write(dir, "legacy.js", "const k = process.env.ANTHROPIC_API_KEY;");
    const violations = findBundleViolations(dir, keyNeedles({}));
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("legacy.js");
    expect(violations[0].needle).toBe("ANTHROPIC_API_KEY");
  });

  it("reports nothing for a clean client bundle", () => {
    const dir = tempDir();
    write(dir, "app.js", "const n = 1;");
    expect(findBundleViolations(dir, keyNeedles({}))).toEqual([]);
  });

  it("scans nested subdirectories like next's chunk layout", () => {
    const dir = tempDir();
    write(dir, "chunks/app/page.js", "process.env.GEMINI_API_KEY");
    const violations = findBundleViolations(dir, keyNeedles({}));
    expect(violations.map((v) => v.file).sort()).toEqual(["chunks/app/page.js"]);
  });

  it("returns no violations when the client output directory is absent", () => {
    const dir = join(tempDir(), "does-not-exist");
    expect(findBundleViolations(dir, keyNeedles({}))).toEqual([]);
  });
});

describe("F11-T05: key needles", () => {
  it("always hunts for every scanned env variable name", () => {
    expect(keyNeedles({})).toEqual([...SCAN_AI_KEY_ENVS]);
  });

  it("adds each key value only when its variable is set", () => {
    expect(
      keyNeedles({ GEMINI_API_KEY: "sk-gem", ANTHROPIC_API_KEY: "sk-ant" }),
    ).toEqual(["GEMINI_API_KEY", "sk-gem", "ANTHROPIC_API_KEY", "sk-ant"]);
  });

  it("adds a value only for the variable that is set", () => {
    expect(keyNeedles({ GEMINI_API_KEY: "sk-gem" })).toEqual([
      "GEMINI_API_KEY",
      "sk-gem",
      "ANTHROPIC_API_KEY",
    ]);
  });
});

describe("F16-T02: scan targets cover every AI key the server reads", () => {
  // The risk a green guard aimed at an unused variable hides a real one: if an
  // AI key is added to config but forgotten in the scan targets, the build
  // passes and proves nothing. This suite must fail on that omission.
  it("scans every AI-key environment variable the server reads", () => {
    expect(AI_KEY_ENV_NAMES.length).toBeGreaterThan(0);
    for (const name of AI_KEY_ENV_NAMES) {
      expect(SCAN_AI_KEY_ENVS).toContain(name);
    }
  });
});

describe("F11-T05/F16-T02: deliberately referencing a key fails the build step", () => {
  // Run the real entrypoint against a synthetic `.next/static` tree, with cwd
  // pointed at that tree (the script scans `process.cwd()/.next/static`). The
  // tsx binary and script are resolved from the project root so the child does
  // not depend on node_modules in the throwaway cwd.
  const ROOT = process.cwd();
  const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
  const SCRIPT = resolve(ROOT, "scripts", "check-client-bundle.ts");
  const CHECK = `${JSON.stringify(TSX)} ${JSON.stringify(SCRIPT)}`;

  it("exits non-zero when a client file references GEMINI_API_KEY (F16-T02)", () => {
    const dir = tempDir();
    write(
      dir,
      join(".next", "static", "chunks", "app", "page.js"),
      "process.env.GEMINI_API_KEY",
    );
    expect(() => execSync(CHECK, { cwd: dir, stdio: "pipe" })).toThrow();
  });

  it("exits non-zero when a client file carries the GEMINI_API_KEY value (F16-T02)", () => {
    const dir = tempDir();
    const secret = "sk-gem-subprocess-secret-99";
    write(dir, join(".next", "static", "app.js"), `const key = "${secret}";`);
    expect(() =>
      execSync(CHECK, {
        cwd: dir,
        env: { ...process.env, GEMINI_API_KEY: secret },
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("exits non-zero when a client file carries a stale ANTHROPIC reference", () => {
    const dir = tempDir();
    write(
      dir,
      join(".next", "static", "chunks", "app", "page.js"),
      "process.env.ANTHROPIC_API_KEY",
    );
    expect(() => execSync(CHECK, { cwd: dir, stdio: "pipe" })).toThrow();
  });

  it("exits non-zero when a client file carries the ANTHROPIC value", () => {
    const dir = tempDir();
    const secret = "sk-ant-subprocess-secret-99";
    write(dir, join(".next", "static", "app.js"), `const key = "${secret}";`);
    expect(() =>
      execSync(CHECK, {
        cwd: dir,
        env: { ...process.env, ANTHROPIC_API_KEY: secret },
        stdio: "pipe",
      }),
    ).toThrow();
  });

  it("exits zero for a clean client bundle", () => {
    const dir = tempDir();
    write(dir, join(".next", "static", "app.js"), "const n = 1;");
    expect(() => execSync(CHECK, { cwd: dir, stdio: "pipe" })).not.toThrow();
  });
});

describe("F11-T05: wired into the standard build", () => {
  it("build runs the check after next build, as a non-optional step", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const build = pkg.scripts?.build ?? "";
    expect(build).toContain("next build");
    expect(build).toContain("check:client-bundle");
    const check = pkg.scripts?.["check:client-bundle"] ?? "";
    expect(check).toMatch(/check-client-bundle\.ts/);
    expect(CLIENT_BUNDLE_DIR).toBe(".next/static");
  });
});