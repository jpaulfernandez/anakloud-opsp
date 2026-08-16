import { NextResponse } from "next/server";
import type { ClientBase } from "pg";
import type { ResolvedSession } from "./session";

// Lock enforcement (F06-T04, PR5, tech_infrastructure.md §8 T3).
//
// PR5 is the load-bearing rule of this feature: original answers are immutable
// after submit. The derived OPSP is editable; the raw `answers` are not. This
// module is the single place that codifies "submitted" so every present and
// future code path forces through the same decision instead of each route
// rolling its own.
//
// The lock is enforced at two layers, both here:
//
//   1. Route layer — `rejectIfSubmitted` turns a locked session into the one
//      standardized HTTP 409 that a mutation route returns before it writes.
//      It runs on the already-resolved session, so it costs no query.
//
//   2. Data layer — `assertAnswersWritable` throws `AnswerLockedError` for a
//      submitted respondent inside the same transaction that would write.
//      Every answer write flows through `upsertAnswer`, which calls it first,
//      so a route added next month that forgets the route-level 409 still
//      cannot alter an answer: the write is refused before any row is touched.
//      This is also what prevents the OPSP editing feature (F07-T05) from ever
//      writing to `answers` — it cannot, because the only answers writer is the
//      lock-aware one.

/** The data-layer signal that a write to `answers` was refused by the lock. */
export class AnswerLockedError extends Error {
  constructor() {
    super("answers are immutable once submitted");
    this.name = "AnswerLockedError";
  }
}

/**
 * The route-layer 409. Returns the standardized conflict response when the
 * session's respondent has submitted, and null otherwise. Every mutation route
 * returns this response unchanged, so the property test can assert a single
 * 409 shape over all registered mutation routes.
 */
export function rejectIfSubmitted(
  session: Pick<ResolvedSession, "submittedAt">,
): NextResponse | null {
  if (session.submittedAt !== null && session.submittedAt !== undefined) {
    return NextResponse.json({ ok: false, locked: true }, { status: 409 });
  }
  return null;
}

/**
 * The data-layer guard. Throws `AnswerLockedError` when the respondent has
 * submitted; returns normally otherwise. Intended to run first inside the
 * transaction that owns the write, so a locked respondent is refused before
 * any row is touched. This is the absolute guarantee behind PR5 — the route is
 * the fast rejection, this is the one that cannot be forgotten by a new path.
 */
export async function assertAnswersWritable(
  db: ClientBase,
  respondentId: string,
): Promise<void> {
  const { rows } = await db.query(
    "select submitted_at from respondents where id = $1",
    [respondentId],
  );
  const submittedAt = rows[0]?.submitted_at;
  if (submittedAt !== null && submittedAt !== undefined) {
    throw new AnswerLockedError();
  }
}