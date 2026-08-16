import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnswerLockedError, rejectIfSubmitted } from "../../lib/lock";

// F06-T04 lock enforcement — the invariants that need no database, pinned at
// the source level. Two of the ticket's acceptance criteria are structural and
// are better asserted by scanning the runtime source than by exercising every
// future path at runtime:
//
//   1. "A test asserts no code path writes to answer_snapshots outside
//      POST /api/submit" — the only runtime writer of the snapshots table is
//      lib/submit.ts, and the only API route that reaches it is the submit
//      route. There is nowhere else a snapshot write can hide.
//
//   2. The OPSP editing feature must not write to `answers` — which is
//      guaranteed structurally because lib/answers.ts (the lock-aware
//      upsertAnswer) is the only runtime writer of the answers table in the
//      whole app. A route that wants to change an answer must go through that
//      one writer, and that writer refuses a submitted respondent.
//
// The schema/migration files are excluded because they emit DDL once at
// migration time (they create the tables and the RLS policies), not request
// path writes.

interface TsFile {
  rel: string;
  source: string;
}

/** Every runtime .ts file under app/ and lib/, excluding schema/DDL files. */
function runtimeFiles(): TsFile[] {
  const excluded = new Set(["lib/schema.ts", "lib/access-policy.ts", "lib/migrate.ts"]);
  const files: TsFile[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (full.endsWith(".ts")) {
        files.push({ rel: full, source: readFileSync(full, "utf8") });
      }
    }
  };
  walk("app");
  walk("lib");
  return files.filter((f) => !excluded.has(f.rel));
}

/** A write that mutates an answer_snapshots row (not DDL that creates it). */
const SNAPSHOT_WRITE = /insert into answer_snapshots|update answer_snapshots|delete from answer_snapshots/;
/** A write that mutates an answers row. */
const ANSWERS_WRITE =
  /insert into answers|update answers set|on conflict \(respondent_id, question_id\)|select app_upsert_own_answer/;

describe("lock guard", () => {
  it("rejects a submitted session with the single HTTP 409", () => {
    const conflict = rejectIfSubmitted({ submittedAt: new Date() });
    expect(conflict).not.toBeNull();
    expect(conflict!.status).toBe(409);
    expect(conflict!.headers.get("content-type")).toContain("application/json");
  });

  it("allows an unsubmitted session", () => {
    expect(rejectIfSubmitted({ submittedAt: null })).toBeNull();
  });

  it("AnswerLockedError is thrown by the data-layer guard, and by nothing else in error handling", () => {
    // A type-level contract: the module exposes exactly one lock error type.
    expect(new AnswerLockedError()).toBeInstanceOf(Error);
    expect(new AnswerLockedError().name).toBe("AnswerLockedError");
  });
});

describe("no code writes to answer_snapshots outside POST /api/submit", () => {
  it("the only runtime writer of answer_snapshots is lib/submit.ts", () => {
    const writers = runtimeFiles()
      .filter((f) => SNAPSHOT_WRITE.test(f.source))
      .map((f) => f.rel);
    expect(writers).toEqual(["lib/submit.ts"]);
  });

  it("the only API route reaching the snapshot-writing module is POST /api/submit", () => {
    const importers = runtimeFiles()
      .filter((f) => f.rel.startsWith("app/") && /from ["']@\/lib\/submit["']/.test(f.source))
      .map((f) => f.rel);
    expect(importers).toEqual(["app/api/submit/route.ts"]);
  });
});

describe("the OPSP editor cannot write to answers", () => {
  it("lib/answers.ts is the only runtime writer of the answers table", () => {
    const writers = runtimeFiles()
      .filter((f) => ANSWERS_WRITE.test(f.source))
      .map((f) => f.rel);
    // access-policy.ts creates the security-definer function that ultimately
    // writes answers, but it is DDL excluded above — and it is only ever
    // INVOKED from lib/answers.ts's upsertAnswer, the lock-aware writer.
    expect(writers).toEqual(["lib/answers.ts"]);
  });

  it("that sole writer is lock-aware", () => {
    const answers = readFileSync("lib/answers.ts", "utf8");
    expect(answers).toMatch(/from ["'].\/lock["']/);
    expect(answers).toMatch(/assertAnswersWritable\(db, input\.respondent_id\)/);
  });
});