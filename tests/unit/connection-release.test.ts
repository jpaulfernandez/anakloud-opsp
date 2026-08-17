import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// F17-T03 (M03) acceptance: every connection obtained through the database
// boundary must be released on both the success and the error path, and no
// module may create an unpooled long-lived client that survives across
// serverless invocations.
//
// The boundary is `lib/db.ts` — the only module that constructs a driver
// (`createDbClient()` for request traffic, `createMigrationClient()` for
// migrations). Everything downstream is owned by the caller, which is
// responsible for `connect()`/`end()`. This test is a static source scan, not
// a runtime test: it walks the application modules (app/, lib/, scripts/),
// finds every connection binding, and verifies two invariants directly from
// the code:
//
//   1. Every bound connection is released inside a `finally` block, so the
//      release runs whether the request body throws or not (the only shape
//      that satisfies "IF a request throws after connecting, THEN the
//      connection SHALL still be released").
//   2. No connection binding sits at module top-level scope — a client that
//      is created at module load lives across every serverless invocation
//      instead of being request-scoped, which is exactly what the SHALL NOT
//      forbids.
//
// It deliberately scans app/, lib/ and scripts/ only (production modules), not
// tests/ — a test fixture may hold a connection open for its whole suite and
// release it in `afterAll`, which is a different lifecycle from a request.

const ROOT = resolve(process.cwd());

// The factory module is where the drivers are *defined*, so it necessarily
// mentions them; exclude it from the binding scan (it owns construction, not
// a connection lifecycle).
const FACTORY_MODULE = join(ROOT, "lib", "db.ts");

/** Match a connection binding: `const X = createDbClient()` /
 * `const X = createMigrationClient()`. Captures the bound variable name. */
const BINDING = /const\s+([A-Za-z_$][\w$]*)\s*=\s*(createDbClient|createMigrationClient)\(\)/g;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
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

/**
 * Return the character index of every `{` and `}` in `source` that belongs to
 * code, skipping string/template literals, line comments and block comments.
 * This is what lets the scan be brace-aware without a compiler: a brace inside
 * a SQL string or a prose comment cannot shift the depth or open a fake block.
 * A plain apostrophe in a comment (e.g. "respondent's") is not a delimiter.
 */
function codeBraces(source: string): Array<{ char: "{" | "}"; index: number }> {
  const braces: Array<{ char: "{" | "}"; index: number }> = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    // line comment
    if (c === "/" && source[i + 1] === "/") {
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    // block comment
    if (c === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    // string / template literal
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) break;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "{" || c === "}") braces.push({ char: c, index: i });
    i += 1;
  }
  return braces;
}

/** Return the char-index ranges of every `finally { ... }` block body. */
function finallyBlockRanges(source: string): Array<[number, number]> {
  const braces = codeBraces(source);
  const ranges: Array<[number, number]> = [];
  for (let j = 0; j < braces.length; j += 1) {
    const open = braces[j];
    if (open.char !== "{") continue;
    // The keyword immediately before this `{` must be `finally`. Take it from
    // a window that also spans a preceding `} catch ...` / close brace.
    const before = source.slice(Math.max(0, open.index - 24), open.index);
    if (!/(?:^|[^\w$])finally[\s(]*$/.test(before)) continue;

    let depth = 1;
    for (let k = j + 1; k < braces.length; k += 1) {
      if (braces[k].char === "{") depth += 1;
      else {
        depth -= 1;
        if (depth === 0) {
          ranges.push([open.index + 1, braces[k].index]);
          break;
        }
      }
    }
  }
  return ranges;
}

/** Code brace-depth at `index`: depth 0 means module top-level scope. */
function braceDepthAround(source: string, index: number): number {
  let depth = 0;
  for (const b of codeBraces(source)) {
    if (b.index > index) break;
    depth += b.char === "{" ? 1 : -1;
  }
  return depth;
}

function bindingsOf(source: string): Array<{ name: string; index: number }> {
  const out: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  BINDING.lastIndex = 0;
  while ((m = BINDING.exec(source))) {
    out.push({ name: m[1], index: m.index });
  }
  return out;
}

describe("connection lifecycle guarantees (F17-T03)", () => {
  const modules = [
    ...collectSourceFiles(join(ROOT, "app")),
    ...collectSourceFiles(join(ROOT, "lib")).filter((f) => f !== FACTORY_MODULE),
    ...collectSourceFiles(join(ROOT, "scripts")),
  ];

  it("releases every bound connection inside a finally block", () => {
    const offenders: string[] = [];
    for (const file of modules) {
      const source = readFileSync(file, "utf8");
      const finals = finallyBlockRanges(source);

      // Group binding names so we can count per variable: every `const db =
      // createDbClient()` needs its own release, so the number of finally-
      // enclosed `.end()` calls for a name must at least match its bindings.
      const bindings = new Map<string, number>();
      for (const b of bindingsOf(source)) {
        bindings.set(b.name, (bindings.get(b.name) ?? 0) + 1);
      }

      for (const [name, count] of bindings) {
        const endCall = new RegExp(`\\b${name}\\.end\\(\\)`, "g");
        let releasedInFinally = 0;
        let m: RegExpExecArray | null;
        while ((m = endCall.exec(source))) {
          if (finals.some(([start, end]) => m!.index > start && m!.index < end)) {
            releasedInFinally += 1;
          }
        }
        if (releasedInFinally < count) {
          offenders.push(
            `${file}: ${count} binding${count === 1 ? "" : "s"} of \`${name}\` need ` +
              `releases inside a finally block (found ${releasedInFinally})`,
          );
        }
      }
    }
    expect(offenders, "every owned connection must be released in a finally path").toEqual([]);
  });

  it("declares no connection at module top-level scope", () => {
    const offenders: string[] = [];
    for (const file of modules) {
      const source = readFileSync(file, "utf8");
      for (const b of bindingsOf(source)) {
        if (braceDepthAround(source, b.index) <= 0) {
          offenders.push(
            `${file}: connection \`${b.name}\` created at module scope (depth 0)`,
          );
        }
      }
    }
    expect(
      offenders,
      "a module-level client would survive across serverless invocations (SHALL NOT)",
    ).toEqual([]);
  });

  it("scans at least one production connection so the test is not vacuous", () => {
    let total = 0;
    for (const file of modules) {
      total += bindingsOf(readFileSync(file, "utf8")).length;
    }
    expect(total).toBeGreaterThan(0);
  });
});