import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AI_KEY_ENV,
  CLIENT_BUNDLE_DIR,
  findBundleViolations,
  keyNeedles,
} from "../../lib/client-bundle-check";

// F11-T05 — build-time guard that no AI key reaches a client bundle. Two
// acceptance criteria: (1) deliberately referencing the key in a client
// component fails the build, and (2) the check is part of the standard build,
// not an optional step. The detection half is unit-tested here against a
// synthetic client-bundle directory and, for the actual exit-code behaviour,
// by running the check script against such a directory; the wiring half is
// asserted against package.json.

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
  it("flags a client file that references the key env variable name", () => {
    const dir = tempDir();
    write(dir, "app.js", "const k = process.env.ANTHROPIC_API_KEY;");
    const violations = findBundleViolations(dir, keyNeedles({}));
    expect(violations).toHaveLength(1);
    expect(violations[0].file).toBe("app.js");
    expect(violations[0].needle).toBe(AI_KEY_ENV);
  });

  it("flags a client file that carries the key value", () => {
    const dir = tempDir();
    const secret = "sk-ant-synthetic-secret-abc123";
    write(dir, "chunk.js", `const key = "${secret}";`);
    const violations = findBundleViolations(
      dir,
      keyNeedles({ ANTHROPIC_API_KEY: secret }),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].needle).toBe(secret);
  });

  it("reports nothing for a clean client bundle", () => {
    const dir = tempDir();
    write(dir, "app.js", "const n = 1;");
    expect(findBundleViolations(dir, keyNeedles({}))).toEqual([]);
  });

  it("scans nested subdirectories like next's chunk layout", () => {
    const dir = tempDir();
    write(dir, "chunks/app/page.js", "process.env.ANTHROPIC_API_KEY");
    const violations = findBundleViolations(dir, keyNeedles({}));
    expect(violations.map((v) => v.file).sort()).toEqual(["chunks/app/page.js"]);
  });

  it("returns no violations when the client output directory is absent", () => {
    const dir = join(tempDir(), "does-not-exist");
    expect(findBundleViolations(dir, keyNeedles({}))).toEqual([]);
  });
});

describe("F11-T05: key needles", () => {
  it("always hunts for the env variable name", () => {
    expect(keyNeedles({})).toEqual([AI_KEY_ENV]);
  });

  it("adds the key value only when the var is set", () => {
    expect(keyNeedles({ ANTHROPIC_API_KEY: "sk-secret" })).toEqual([
      AI_KEY_ENV,
      "sk-secret",
    ]);
  });
});

describe("F11-T05: deliberately referencing the key fails the build step", () => {
  // Run the real entrypoint against a synthetic `.next/static` tree, with cwd
  // pointed at that tree (the script scans `process.cwd()/.next/static`). The
  // tsx binary and script are resolved from the project root so the child does
  // not depend on node_modules in the throwaway cwd.
  const ROOT = process.cwd();
  const TSX = resolve(ROOT, "node_modules", ".bin", "tsx");
  const SCRIPT = resolve(ROOT, "scripts", "check-client-bundle.ts");
  const CHECK = `${JSON.stringify(TSX)} ${JSON.stringify(SCRIPT)}`;

  it("exits non-zero when a client file references the key env name", () => {
    const dir = tempDir();
    write(
      dir,
      join(".next", "static", "chunks", "app", "page.js"),
      "process.env.ANTHROPIC_API_KEY",
    );
    expect(() => execSync(CHECK, { cwd: dir, stdio: "pipe" })).toThrow();
  });

  it("exits non-zero when a client file carries the key value", () => {
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