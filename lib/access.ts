import type { ClientBase } from "pg";

// Row-level security context (F01-T04). Migration 0002 gates every row of
// `answers`, `answer_snapshots` and `opsp_drafts` on the current respondent,
// which the policies read from the transaction setting `app.respondent_id`.
// That setting can only be scoped with `set local`, which requires a live
// transaction, so any code that touches a gated table must run through
// withRespondentContext. There is no facilitator context to construct: a
// facilitator is a respondent row with `is_facilitator = true`, so acting as
// the facilitator is just passing that respondent's id.

/**
 * Run `run` inside a transaction with `app.respondent_id` set, so the RLS
 * policies resolve who is acting. Commits on success, rolls back on error.
 */
export async function withRespondentContext<T>(
  db: ClientBase,
  respondentId: string,
  run: (db: ClientBase) => Promise<T>,
): Promise<T> {
  await db.query("begin");
  try {
    // set_config with is_local = true is the parameterised form of "set local";
    // the raw `set local x = $1` syntax rejects pg parameters. The `true` keeps
    // it scoped to the transaction, so a reused connection never leaks context.
    await db.query("select set_config('app.respondent_id', $1, true)", [respondentId]);
    const result = await run(db);
    await db.query("commit");
    return result;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}