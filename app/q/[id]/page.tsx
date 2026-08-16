import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createDbClient } from "@/lib/db";
import { resolveSession, SESSION_COOKIE } from "@/lib/session";
import { groundRulesAcknowledged } from "@/lib/respondent";

// Question route gate (F02-T05, FR-5, ui_ux.md §4.2).
//
// The ground-rules acknowledgement is a hard gate in front of every question:
// "IF a respondent navigates directly to a question URL without having
// acknowledged the ground rules, THEN the system SHALL redirect to the
// ground-rules screen" (FR-5). That whole gate lives here: an unauthenticated
// session bounces to "/" and an unacknowledged respondent bounces to
// /ground-rules, and only an acknowledged respondent proceeds.
//
// F03-T01 replaces this page's body with the real question shell. The route
// gate — resolve the session, then acknowledged? proceed or bounce — is what
// F02-T05 owns and is kept as the whole of this page so the acceptance test
// (direct navigation to /q/7 before acknowledgement redirects) can run before
// the question engine exists. The id is treated opaquely and not validated,
// because the question shell defines what a valid id is; the gate is
// independent of it.
export default async function QuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  const db = createDbClient();
  await db.connect();
  try {
    const session = await resolveSession(db, token);
    if (!session) redirect("/");
    if (!(await groundRulesAcknowledged(db, session.respondentId))) {
      redirect("/ground-rules");
    }
  } finally {
    await db.end();
  }

  return (
    <main>
      <h1>{id}</h1>
      <p>The question shell lands here in F03-T01.</p>
    </main>
  );
}