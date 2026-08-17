import type { Metadata } from "next";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { WelcomeForm } from "./WelcomeForm";

// Welcome / name entry (F02-T04, FR-2, ui_ux.md §4.1).
//
// The first-run destination a fresh claim lands on. The "Before we start" copy
// is mandatory and rendered verbatim from ui_ux.md §4.1 — this tool asks
// people to be candid, and copy that sounds like a corporate survey gets
// corporate answers. The form itself is a client component so the continue
// button can be gated on a non-blank name without a round trip. Reaching this
// route requires a valid session: requirePageSession (F02-T06) resolves the
// identity or redirects an unauthenticated visitor to the claim screen, and a
// returning respondent with a name on file is sent straight past by the claim
// redirect rather than being asked a second time.

export const metadata: Metadata = {
  title: "Before we start",
};

export default async function WelcomePage() {
  let initialName = "";
  let initialEmail = "";
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    const { rows } = await db.query<{
      display_name: string | null;
      email: string | null;
    }>("select display_name, email from respondents where id = $1", [
      session.respondentId,
    ]);
    const row = rows[0];
    initialName = row?.display_name ?? "";
    initialEmail = row?.email ?? "";
  } finally {
    await db.end();
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-16 text-base">
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <section aria-labelledby="before-we-start" className="space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
            Anakloud Alignment
          </div>
          <h2
            id="before-we-start"
            className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl"
          >
            Before we start.
          </h2>
          <p className="text-base leading-relaxed text-neutral-700">
            This is a set of questions about Anakloud — where it&apos;s going, who
            it&apos;s for, what has to happen next. Everyone answers on their own,
            before we talk as a group.
          </p>
          <div className="rounded-xl border-l-4 border-cobalt-600 bg-cobalt-50/60 p-4">
            <p className="text-sm leading-relaxed text-cobalt-950">
              <strong>There are no right answers and this isn&apos;t a test.</strong>{" "}
              If your answer is different from everyone else&apos;s, that&apos;s the
              single most useful thing that can come out of this.
            </p>
          </div>
          <p className="text-sm leading-relaxed text-neutral-500">
            Takes about 25 minutes. You can stop anytime and come back — nothing
            gets lost.
          </p>
        </section>

        <div className="mt-8 border-t border-neutral-100 pt-8">
          <WelcomeForm initialName={initialName} initialEmail={initialEmail} />
        </div>
      </div>
    </main>
  );
}