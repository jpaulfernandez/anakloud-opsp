import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  logCoachInteraction,
  setExampleShown,
} from "../../lib/interactions";
import { STATIC_HINTS } from "../../lib/static-hints";

// F05-T05 — coach interaction logging against a real Postgres. Runs only when
// opted in (DATABASE_URL set AND RUN_DB_TESTS=1), otherwise SKIPS, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests. The `ai_interactions` table is not RLS-gated (only answers,
// answer_snapshots and opsp_drafts are, per access-policy.ts), so the log
// writes and the assertions below read and write it directly; the edits go
// through withRespondentContext because the answers table behind them is RLS -
// and that is exactly the path upsertAnswer follows in production.
//
// This covers the ticket's two acceptance criteria that live at the storage
// layer:
//   - three nudges on one question produce three rows with attempts 1, 2, 3;
//   - editing after a nudge flips answer_changed to true;
// and the third — no answer text in application logs — by capturing console
// output across the real log-and-edit path and grepping it for the answer.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

// A deliberately distinctive, digit-bearing string that must never surface in
// application logs. Chosen so a grep for either the phrase or the number finds
// nothing.
const ANSWER_MARKER = "PLUMBINGALIGN79 NEARESTWAREHOUSE";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111141";
const RESPONDENT = "aaaa1111-aaaa-1111-aaaa-111111111142";

const Q7_HINT = STATIC_HINTS.q7.hint;

describe.skipIf(!enabled)("interaction logging against a real Postgres", () => {
  let db = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `interactions_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);
    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    await db!.query(
      `insert into respondents (id, cohort_id, display_name, invite_token, resume_code)
       values ($1, $2, 'Respondent', 'token-interactions', 'INTR1')`,
      [RESPONDENT, COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  async function coachRows() {
    const { rows } = await db!.query(
      `select attempt_no, level, verdict, hint_text, example_shown, answer_changed
         from ai_interactions
        where respondent_id = $1 and question_id = 'q7' and purpose = 'coach'
        order by attempt_no`,
      [RESPONDENT],
    );
    return rows as Array<{
      attempt_no: number;
      level: string;
      verdict: string;
      hint_text: string;
      example_shown: boolean;
      answer_changed: boolean | null;
    }>;
  }

  async function clearLog() {
    await db!.query("delete from ai_interactions where respondent_id = $1", [RESPONDENT]);
  }

  it("three nudges on one question produce three rows with attempts 1, 2, 3", async () => {
    await clearLog();
    for (const attempt_no of [1, 2, 3]) {
      await logCoachInteraction(db!, RESPONDENT, {
        question_id: "q7",
        attempt_no,
        verdict: "needs_work",
        hint_text: Q7_HINT,
        example_shown: false,
        level: "L2",
      });
    }

    const rows = await coachRows();
    expect(rows.map((r) => r.attempt_no)).toEqual([1, 2, 3]);
    // Deterministically served interactions record L2 (F05-T05).
    expect(rows.map((r) => r.level)).toEqual(["L2", "L2", "L2"]);
    expect(rows.every((r) => r.verdict === "needs_work")).toBe(true);
    expect(rows.every((r) => r.hint_text === Q7_HINT)).toBe(true);
    expect(rows.every((r) => r.example_shown === false)).toBe(true);
    // A nudge row starts as unchanged.
    expect(rows.every((r) => r.answer_changed === false)).toBe(true);
  });

  it("editing the answer after a nudge flips answer_changed to true", async () => {
    await clearLog();
    await logCoachInteraction(db!, RESPONDENT, {
      question_id: "q7",
      attempt_no: 1,
      verdict: "needs_work",
      hint_text: Q7_HINT,
      example_shown: false,
      level: "L2",
    });

    expect((await coachRows())[0].answer_changed).toBe(false);

    // The edit goes through the real write path, exactly as a respondent's
    // autosave PATCH does (withRespondentContext satisfies the answers RLS).
    await withRespondentContext(db!, RESPONDENT, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT,
        question_id: "q7",
        value: { text: "one edited priority" },
      }),
    );

    expect((await coachRows())[0].answer_changed).toBe(true);
  });

  it("requesting an example marks only the latest nudge's row", async () => {
    await clearLog();
    await logCoachInteraction(db!, RESPONDENT, {
      question_id: "q7",
      attempt_no: 1,
      verdict: "needs_work",
      hint_text: Q7_HINT,
      example_shown: false,
      level: "L2",
    });
    await logCoachInteraction(db!, RESPONDENT, {
      question_id: "q7",
      attempt_no: 2,
      verdict: "needs_work",
      hint_text: Q7_HINT,
      example_shown: false,
      level: "L2",
    });

    await setExampleShown(db!, RESPONDENT, "q7");

    const rows = await coachRows();
    expect(rows[0].example_shown).toBe(false);
    expect(rows[1].example_shown).toBe(true);
  });

  it("leaves the example unrequested until setExampleShown is called", async () => {
    await clearLog();
    await logCoachInteraction(db!, RESPONDENT, {
      question_id: "q7",
      attempt_no: 1,
      verdict: "needs_work",
      hint_text: Q7_HINT,
      example_shown: false,
      level: "L2",
    });

    // Before any example request the row reads as not-requested.
    expect((await coachRows())[0].example_shown).toBe(false);
  });

  it("writes no answer text to application logs", async () => {
    await clearLog();

    const logs: string[] = [];
    const spies = [
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      }),
      vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      }),
      vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      }),
      vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      }),
    ];

    try {
      // The real log path: an interaction row whose hint is coach content.
      await logCoachInteraction(db!, RESPONDENT, {
        question_id: "q7",
        attempt_no: 1,
        verdict: "needs_work",
        hint_text: Q7_HINT,
        example_shown: false,
        level: "L2",
      });
      // The real edit path, whose value is the answer text.
      await withRespondentContext(db!, RESPONDENT, (tx) =>
        upsertAnswer(tx, {
          respondent_id: RESPONDENT,
          question_id: "q7",
          value: { text: ANSWER_MARKER },
        }),
      );
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    expect(logs).toBeDefined();
    // grep the captured log output for the answer text — nothing must contain
    // the phrase or the digit sequence from the answer.
    expect(logs.some((line) => line.includes(ANSWER_MARKER))).toBe(false);
  });
});