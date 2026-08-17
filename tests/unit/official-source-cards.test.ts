import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAttachInput, parseRemoveInput } from "../../lib/official-source-cards";

// F15-T02 — source cards (FR-37, ui_ux.md §4.20). These are the pure decisions
// of the source-card path: body validation, and the two structural guarantees
// that matter most. The route and the lib resolve the picker pool and attach /
// remove against a real Postgres in official-source-cards.integration.test.ts;
// the parser pins and the "never writes answers" source pins keep the PR5 and
// private-row guarantees honest here without a database.

describe("F15-T02 parseAttachInput", () => {
  it("accepts a well-formed attach body", () => {
    expect(
      parseAttachInput({
        cellId: "bhag",
        respondentId: "99999999-9999-9999-9999-999999999999",
        questionId: "q7",
      }),
    ).toEqual({
      cellId: "bhag",
      respondentId: "99999999-9999-9999-9999-999999999999",
      questionId: "q7",
    });
  });

  it("rejects a non-question questionId, so 'q14d' can never be attached", () => {
    // q14d is a synthetic private-row id, not in QUESTION_IDS. The parser
    // refuses it before any SQL runs — the first of the two guards that keeps
    // the private note out of the source cards.
    expect(
      parseAttachInput({
        cellId: "bhag",
        respondentId: "99999999-9999-9999-9999-999999999999",
        questionId: "q14d",
      }),
    ).toBeNull();
  });

  it("rejects malformed bodies", () => {
    expect(parseAttachInput(null)).toBeNull();
    expect(parseAttachInput("nope")).toBeNull();
    expect(parseAttachInput([])).toBeNull();
    expect(parseAttachInput({ cellId: "not-a-cell", respondentId: "x", questionId: "q1" })).toBeNull();
    expect(parseAttachInput({ cellId: "bhag", respondentId: "", questionId: "q1" })).toBeNull();
    expect(parseAttachInput({ cellId: "bhag", respondentId: "r", questionId: "q99" })).toBeNull();
  });
});

describe("F15-T02 parseRemoveInput", () => {
  it("accepts a well-formed remove body and rejects malformed ones", () => {
    expect(parseRemoveInput({ cellId: "bhag", cardId: "card-1" })).toEqual({
      cellId: "bhag",
      cardId: "card-1",
    });
    expect(parseRemoveInput({ cellId: "bhag", cardId: "" })).toBeNull();
    expect(parseRemoveInput({ cellId: "nope", cardId: "card-1" })).toBeNull();
    expect(parseRemoveInput(undefined)).toBeNull();
  });
});

describe("the source-card path structurally cannot write to answers (PR5)", () => {
  // PR5's claim for F15-T02 is that attaching or removing a card never touches
  // the answers table. That holds structurally because the only write the
  // source-card route can reach is writeOfficialCellsVersion's
  // `insert into opsp_drafts` in lib/official-opsp.ts; the source-card lib and
  // route only read from answers (the picker pool and the attach re-verification)
  // and never call upsertAnswer. These source pins keep that honest if a future
  // edit silently starts writing answers.
  const route = readFileSync(resolve("app/api/admin/official-opsp/source-cards/route.ts"), "utf8");
  const lib = readFileSync(resolve("lib/official-source-cards.ts"), "utf8");

  it("neither the source-card route nor its lib writes to the answers table", () => {
    expect(route).not.toMatch(/upsertAnswer/);
    expect(route).not.toMatch(/insert into answers/);
    expect(lib).not.toMatch(/upsertAnswer/);
    expect(lib).not.toMatch(/insert into answers/);
  });

  it("the only write in the source-card path is a new opsp_drafts version", () => {
    expect(route).not.toMatch(/insert into/);
    // The lib's answer reads are delegated to lib/answers.ts (F01-T03); the
    // source-card module itself writes nothing to answers and runs no direct
    // select from the answers table, so the private rows stay out by contract.
    expect(lib).not.toMatch(/insert into/);
    expect(lib).not.toMatch(/from\s+answers/i);
    expect(lib).toMatch(/findPublicSourceAnswer/);
    expect(lib).toMatch(/listSourceAnswerRows/);
  });
});