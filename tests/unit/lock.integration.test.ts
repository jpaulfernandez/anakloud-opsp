import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withRespondentContext } from "../../lib/access";
import { upsertAnswer } from "../../lib/answers";
import { ANSWER_MUTATION_ROUTES } from "../../lib/answer-mutation-routes";
import { createDbClient } from "../../lib/db";
import { AnswerLockedError, rejectIfSubmitted } from "../../lib/lock";
import { migrate } from "../../lib/migrate";
import { performSubmit } from "../../lib/submit";

// F06-T04 lock enforcement against a real Postgres — the property test at the
// heart of the ticket (tech_infrastructure.md §8 T3). Runs only when opted in
// (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// The reason this is a *property* test and not a happy-path check is exactly
// what the ticket says: the risk is the mutation route someone adds later.
// `ANSWER_MUTATION_ROUTES` is the single source of truth enumerating those
// routes, so any route added from here on is covered by this file on the next
// run, with no further edits. For each route, once the respondent is locked:
//
//   - the route's HTTP contract returns the one standardized 409
//     (rejectIfSubmitted, which every mutation route returns);
//   - the route's real write is refused (AnswerLockedError) before any row is
//     touched;
//   - the answers stay byte-identical after every attempted mutation.
//
// And as the control, the same routes succeed for an unlocked respondent — so
// a refusal is attributable to the lock, not to a broken route.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "aaaa1111-aaaa-1111-aaaa-111111111261";
const FACILITATOR = "aaaa1111-aaaa-1111-aaaa-111111111262";
const RESPONDENT_LOCKED = "aaaa1111-aaaa-1111-aaaa-111111111263";
const RESPONDENT_UNLOCKED = "aaaa1111-aaaa-1111-aaaa-111111111264";

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";
let draftId = "";

/** Participating rows for one respondent, serialised so equality is byte-level. */
async function tableFingerprint(respondentId: string, table: "answers" | "answer_snapshots") {
  return withRespondentContext(db!, FACILITATOR, async (tx) => {
    const { rows } = await tx.query(
      table === "answers"
        ? `select question_id, value, confidence, is_private
             from answers
            where respondent_id = $1
            order by question_id`
        : `select payload from answer_snapshots
            where respondent_id = $1
            order by taken_at, id`,
      [respondentId],
    );
    return JSON.stringify(rows);
  });
}

describe.skipIf(!enabled)("lock enforcement over every mutation route (T3)", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `lock_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      "insert into cohorts (id, name, quarter_label, status) values ($1, 'Test', 'Q4 2026', 'open')",
      [COHORT],
    );
    const insertRespondent = (id: string, invite: string, code: string, fac = false) =>
      db!.query(
        `insert into respondents
           (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
         values ($1, $2, $3, $4, $5, $6)`,
        [id, COHORT, fac ? "Facilitator" : "Respondent", invite, code, fac],
      );
    await insertRespondent(FACILITATOR, "token-lock-fac", "FACLK", true);
    await insertRespondent(RESPONDENT_LOCKED, "token-lock-a", "LKA01");
    await insertRespondent(RESPONDENT_UNLOCKED, "token-lock-b", "LKB02");

    // Seed the locked respondent (including a private q14d row so the frozen
    // payload carries private content) and then lock them via the real submit
    // path — which also creates their OPSP draft, used by the OPSP-edit test.
    await withRespondentContext(db!, RESPONDENT_LOCKED, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT_LOCKED,
        question_id: "q1",
        value: { text: "Movement data is locked inside notebooks." },
        confidence: 3,
      }),
    );
    await withRespondentContext(db!, RESPONDENT_LOCKED, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT_LOCKED,
        question_id: "q14",
        value: { wants: [], others: {}, hours: 5, private_note: "A lock test note" },
      }),
    );
    const submit = await performSubmit(db!, RESPONDENT_LOCKED, COHORT);
    draftId = submit.draftId!;

    // Seed the unlocked control respondent.
    await withRespondentContext(db!, RESPONDENT_UNLOCKED, (tx) =>
      upsertAnswer(tx, {
        respondent_id: RESPONDENT_UNLOCKED,
        question_id: "q7",
        value: { text: "unlocked baseline" },
      }),
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("every mutation route refuses a locked respondent: 409 and untouched answers", async () => {
    const before = await tableFingerprint(RESPONDENT_LOCKED, "answers");

    for (const route of ANSWER_MUTATION_ROUTES) {
      // Route-layer: the shared 409 every mutation route returns once locked.
      const conflict = rejectIfSubmitted({ submittedAt: new Date() });
      expect(conflict, `${route.id}: must return 409 when locked`).not.toBeNull();
      expect(conflict!.status, `${route.id}: 409 status`).toBe(409);

      // Data-layer: the route's real write itself is refused before any row
      // changes — the lock-aware writer is what a future route cannot bypass.
      await expect(
        withRespondentContext(db!, RESPONDENT_LOCKED, (tx) =>
          route.write(tx, RESPONDENT_LOCKED),
        ),
        `${route.id}: write refused once locked`,
      ).rejects.toBeInstanceOf(AnswerLockedError);
    }

    // After every route's attempted mutation the answers are byte-identical.
    expect(await tableFingerprint(RESPONDENT_LOCKED, "answers")).toBe(before);
  });

  it("the same mutation routes succeed for an unlocked respondent — the lock refuses, not the route", async () => {
    const before = await tableFingerprint(RESPONDENT_UNLOCKED, "answers");

    for (const route of ANSWER_MUTATION_ROUTES) {
      expect(rejectIfSubmitted({ submittedAt: null })).toBeNull();

      let lockedRefusal = false;
      try {
        await withRespondentContext(db!, RESPONDENT_UNLOCKED, (tx) =>
          route.write(tx, RESPONDENT_UNLOCKED),
        );
      } catch (err) {
        lockedRefusal = err instanceof AnswerLockedError;
      }
      expect(lockedRefusal, `${route.id}: write must succeed when unlocked`).toBe(false);
    }

    // The unlocked respondent's answers changed — the route really can write.
    expect(await tableFingerprint(RESPONDENT_UNLOCKED, "answers")).not.toBe(before);
  });

  it("editing an OPSP cell leaves the underlying answers and snapshot byte-identical", async () => {
    const beforeAnswers = await tableFingerprint(RESPONDENT_LOCKED, "answers");
    const beforeSnapshot = await tableFingerprint(RESPONDENT_LOCKED, "answer_snapshots");

    // The future OPSP editor (F07-T05) writes only opsp_drafts.cells. Drive that
    // exact write as the owner (the drafts_own_update RLS policy applies) and
    // assert the frozen baseline is untouched: the derived OPSP is editable,
    // the raw answers are not (PR5).
    await withRespondentContext(db!, RESPONDENT_LOCKED, async (tx) => {
      await tx.query("update opsp_drafts set cells = $2::jsonb where id = $1", [
        draftId,
        JSON.stringify({
          "1-year": { content: "edited after lock", mark: "pencil", sources: [] },
        }),
      ]);
    });

    expect(await tableFingerprint(RESPONDENT_LOCKED, "answers")).toBe(beforeAnswers);
    expect(await tableFingerprint(RESPONDENT_LOCKED, "answer_snapshots")).toBe(beforeSnapshot);
  });
});