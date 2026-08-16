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
    <main>
      <section aria-labelledby="before-we-start">
        <h2 id="before-we-start">Before we start.</h2>
        <p>
          This is a set of questions about Anakloud — where it&apos;s going, who
          it&apos;s for, what has to happen next. Everyone answers on their own,
          before we talk as a group.
        </p>
        <p>
          <strong>There are no right answers and this isn&apos;t a test.</strong>{" "}
          If your answer is different from everyone else&apos;s, that&apos;s the
          single most useful thing that can come out of this.
        </p>
        <p>
          Takes about 25 minutes. You can stop anytime and come back — nothing
          gets lost.
        </p>
      </section>
      <WelcomeForm initialName={initialName} initialEmail={initialEmail} />
    </main>
  );
}