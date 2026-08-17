import type { ClientBase } from "./db";
import { upsertAnswer } from "./answers";

// The registry of every route that can write to a respondent's `answers` rows
// (F06-T04, tech_infrastructure.md §8 T3).
//
// The lock property test enumerates routes FROM THIS LIST rather than a fixed
// set, so the risk the ticket calls out — "the route someone adds later" —
// is closed by construction: when a new mutation path lands, it must register
// here (and refuse a locked respondent via rejectIfSubmitted at the route layer
// plus going through the lock-aware writer at the data layer), and the next
// verify run covers it without anyone touching the test. A route that forgets
// to register is also a code smell: it exists in the app but is invisible to
// the check that protects the baseline.
//
// The `write` member drives the route's real write for a given respondent. The
// property test calls it once per route per lock state, so the test exercises
// the actual persistence path, not a stub.

export interface AnswerMutationRoute {
  /** HTTP verb and path, e.g. "PATCH /api/answers" — the identity used in a test failure message. */
  id: string;
  /**
   * Run the mutation this route performs, for the given respondent. Must be
   * the real write the route performs once past its guard, so the property
   * test refuses it on a locked respondent through the live path.
   */
  write: (db: ClientBase, respondentId: string) => Promise<void>;
}

export const ANSWER_MUTATION_ROUTES: ReadonlyArray<AnswerMutationRoute> = [
  {
    id: "PATCH /api/answers",
    // The primary autosave route (F04-T01). Its route handler returns the
    // shared 409 via rejectIfSubmitted before this write runs; the write itself
    // is the lock-aware upsertAnswer, which independently refuses a submitted
    // respondent (assertAnswersWritable) so the invariant holds even if a
    // future mutation route calls it directly.
    write: (db, respondentId) =>
      upsertAnswer(db, {
        respondent_id: respondentId,
        question_id: "q7",
        value: { text: "mutated after lock" },
      }),
  },
];