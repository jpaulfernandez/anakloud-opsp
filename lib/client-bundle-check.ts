// F11-T05 — build-time guard that no AI key reaches a client bundle.
// spec.md §8: "All AI calls are server-side. No API key ever reaches the
// browser." tech_infrastructure.md §9: "The AI key exists only as a server
// environment variable. No client bundle reference, verified by a build-time
// check."
//
// The scan targets Next's client-only output (`.next/static`) for two things:
//   - the env variable NAME "ANTHROPIC_API_KEY" — a client component that
//     references process.env.ANTHROPIC_API_KEY leaves this string in the
//     browser bundle even though the value resolves to undefined at runtime;
//   - the env variable VALUE — if the key is defined at build time and someone
//     wired it into a client file, next build inlines the literal secret.
//
// Server output (`.next/server`) is deliberately NOT scanned: that is where
// the key is supposed to live. The rule is that all AI calls are server-side;
// server bundles legitimately name the env var.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const AI_KEY_ENV = "ANTHROPIC_API_KEY";

/** Next's client-only output directory, relative to the project root. */
export const CLIENT_BUNDLE_DIR = ".next/static";

export interface BundleViolation {
  /** Path relative to the scanned client-bundle root. */
  file: string;
  /** The secret-bearing string found in that file. */
  needle: string;
}

/**
 * The strings the scan hunts for: the env name always, and the key value only
 * when it is set in the build environment.
 */
export function keyNeedles(env: Record<string, string | undefined> = process.env): string[] {
  const needles = [AI_KEY_ENV];
  const value = env[AI_KEY_ENV];
  if (typeof value === "string" && value.length > 0) {
    needles.push(value);
  }
  return needles;
}

/** Recursively list every regular file under `dir`; no-op when `dir` is absent. */
export function collectFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
}

/** Report every client-bundle file under `root` that contains a forbidden needle. */
export function findBundleViolations(
  root: string,
  needles: string[],
): BundleViolation[] {
  const violations: BundleViolation[] = [];
  for (const file of collectFiles(root)) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      // A client bundle is text; a file we cannot read is not one we care about.
      continue;
    }
    for (const needle of needles) {
      if (text.includes(needle)) {
        violations.push({ file: relative(root, file), needle });
      }
    }
  }
  return violations;
}