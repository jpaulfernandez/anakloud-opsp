import type { ResolvedSession } from "@/lib/session";

// F09-T02 — the admin page's view decision, kept pure so the locked state is
// unit-testable without a request, the same pattern as admitsAdmin in lib/auth
// (and the reason that one is split out too). The admin page is the facilitator's
// home only: a non-facilitator (`away`) is sent back to their own questionnaire,
// a facilitator who has not submitted (`locked`) is held behind the
// "Finish your own answers first." rule (FR-28), and only a submitted
// facilitator (`dashboard`) reaches the dashboard itself.
//
// The pure function never touches the database or the request; the page feeds it
// the DB-resolved session and acts on the verdict.

export type AdminPageView = "away" | "locked" | "dashboard";

export function adminPageView(session: ResolvedSession | null): AdminPageView {
  if (!session || !session.isFacilitator) return "away";
  // submittedAt is null until submit, so this is the FR-28 lock: read the
  // facilitator's own answers before the admin view unlocks.
  return session.submittedAt === null ? "locked" : "dashboard";
}