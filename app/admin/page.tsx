import Link from "next/link";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { adminPageView } from "@/lib/admin";

// F09-T02 — the admin-locked UI state (ui_ux.md §6 "Admin locked", FR-28).
//
// FR-28 keeps the admin view closed until the facilitator's own answers are
// submitted, enforced in code not by convention. The API gate (F09-T01,
// requireAdminSession) already refuses admin traffic server-side; this page is
// the honest client face of that same rule. Its whole job is to hold the
// facilitator at a rule — "Finish your own answers first." with a way back into
// their questionnaire — and to render none of the dashboard behind that
// message. Because the lock is decided from the DB-resolved session (via the
// pure adminPageView), the page can never show admin content to someone simply
// because their browser asked for the URL.
//
// The single-admission rule is not skippable from the client: an unauthenticated
// visitor is redirected to the claim screen by requirePageSession, a
// non-facilitator goes back to their own questionnaire ("away"), and only a
// submitted facilitator reaches the dashboard shell (which F09-T03 fleshes out
// into the roster). Nothing here reads a header, body or query value.

export default async function AdminPage() {
  const db = createDbClient();
  await db.connect();
  try {
    // No valid session → redirect to the claim screen ("/"), never the admin area.
    const session = await requirePageSession(db);

    const view = adminPageView(session);
    if (view === "away") {
      // A respondent is not part of the admin; send them back to their own
      // questionnaire rather than framing them as a locked facilitator.
      redirect("/");
    }
    return view === "locked" ? <AdminLocked /> : <AdminDashboard />;
  } finally {
    await db.end();
  }
}

/**
 * The locked state (FR-28): a rule, not an error. No error styling and no
 * partial admin content — the only thing on the screen is the rule and the
 * way back in to the facilitator's own (unfinished) questionnaire. The resume
 * landing at "/" is the route that maps a returning session onto Continue and
 * the answered list, so the link points there.
 */
function AdminLocked() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Admin
      </h1>
      <p
        data-testid="admin-locked"
        className="mt-3 text-base leading-relaxed text-neutral-600"
      >
        Finish your own answers first.{" "}
        <Link href="/" className="text-neutral-700 underline">
          Resume your questionnaire
        </Link>
      </p>
    </main>
  );
}

/**
 * The dashboard shell a submitted facilitator reaches. It deliberately carries
 * no answer content (FR-29: "No answer content on this screen"); F09-T03 adds
 * the roster table, F09-T04 the level/budget header strip.
 */
function AdminDashboard() {
  return (
    <main className="mx-auto w-full max-w-4xl px-4 pb-10 pt-6 text-base">
      <h1 className="mt-1 text-[21px] leading-snug font-semibold text-neutral-900 md:text-[28px]">
        Admin
      </h1>
    </main>
  );
}