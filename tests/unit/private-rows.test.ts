import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// F01-T03 acceptance: no code may read answer data directly from the `answers`
// table. Every non-facilitator read must go through the single query helper
// (lib/answers.ts), which filters `is_private = false` in the SQL, because
// that is what makes the Q14(d) private-row separation a query-level guarantee
// rather than a filter someone forgets. The only place allowed to select from
// `answers` without the filter is the facilitator read path, also in the
// helper module.

const ROOT = resolve(process.cwd());

const SKIPPED_DIRS = ["node_modules", ".git", ".next", "test-results", "tests"];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.includes(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectSourceFiles(full, acc);
    } else if (extname(full) === ".ts" || extname(full) === ".tsx") {
      acc.push(full);
    }
  }
  return acc;
}

/** Match SQL that selects rows out of the answers table. */
const SELECT_FROM_ANSWERS = /from\s+answers\b/i;

describe("private-row separation (F01-T03)", () => {
  it("keeps every direct select from `answers` inside lib/answers.ts", () => {
    const files = collectSourceFiles(ROOT);
    const offenders = files.filter((file) => {
      if (file === join(ROOT, "lib", "answers.ts")) return false;
      return SELECT_FROM_ANSWERS.test(readFileSync(file, "utf8"));
    });

    expect(offenders).toEqual([]);
  });

  it("requires the single public read helper to carry the exclusion filter", () => {
    const helper = readFileSync(join(ROOT, "lib", "answers.ts"), "utf8");
    // The public path filters in SQL...
    expect(helper).toMatch(/where\s+\S+\s*=\s*\$1\s+and\s+is_private\s*=\s*false/);
    // ...and the facilitator read path is the only other select, without the filter.
    expect(helper).toMatch(/listFacilitatorAnswers/);
  });
});