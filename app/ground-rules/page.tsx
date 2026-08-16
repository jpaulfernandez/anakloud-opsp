import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createDbClient } from "@/lib/db";
import { requirePageSession } from "@/lib/auth";
import { groundRulesAcknowledged } from "@/lib/respondent";
import { GroundRulesForm } from "./GroundRulesForm";

// Ground rules gate (F02-T05, FR-5, FR-15, ui_ux.md §4.2).
//
// The screen after name entry and in front of every question. Name entry
// completes and this screen is shown; direct navigation to a question URL
// before this is shown bounces here instead (FR-5). It is the mechanism that
// makes people answer honestly rather than diplomatically, so the copy is
// mandatory and rendered verbatim from ui_ux.md §4.2 — this whole feature is
// "don't anchor people", and a screen this tool can't make people take
// seriously fails its only job.
//
// The acknowledgement is recorded once on the respondents row. Reaching this
// page while already acknowledged redirects straight to the session's
// destination, so a resume never re-shows the screen.
export const metadata: Metadata = {
  title: "Ground rules",
};

export default async function GroundRulesPage() {
  const db = createDbClient();
  await db.connect();
  try {
    const session = await requirePageSession(db);
    if (await groundRulesAcknowledged(db, session.respondentId)) redirect("/");
  } finally {
    await db.end();
  }

  return (
    <main>
      <section>
        <ul>
          <li>
            <strong>This is a baseline, not a decision.</strong> Nothing you
            write here becomes policy. We&apos;re finding out what each of us
            actually thinks before we agree on anything.
          </li>
          <li>
            <strong>Answer before you talk to anyone.</strong> If you and Ern
            discuss it first, we&apos;ve lost the point.
          </li>
          <li>
            <strong>
              Your answers will be shown side by side with everyone
              else&apos;s
            </strong>
            , without names, when we meet.
          </li>
          <li>
            <strong>One question at the end is private</strong> — only Paul
            sees it. It&apos;s marked clearly when you get there.
          </li>
        </ul>
        <p>Taglish is completely fine. Write it how you&apos;d actually say it.</p>
      </section>
      <GroundRulesForm />
    </main>
  );
}