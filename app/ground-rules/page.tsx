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
    <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-16 text-base">
      <div className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8">
        <div className="mb-6">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cobalt-700 mb-3">
            Ground Rules
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
            How we do this.
          </h1>
        </div>

        <section className="space-y-6">
          <ul className="space-y-4 text-base leading-relaxed text-neutral-800">
            <li className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4 border border-neutral-100">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobalt-100 text-xs font-bold text-cobalt-700">
                1
              </span>
              <div>
                <strong>This is a baseline, not a decision.</strong> Nothing you
                write here becomes policy. We&apos;re finding out what each of us
                actually thinks before we agree on anything.
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4 border border-neutral-100">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobalt-100 text-xs font-bold text-cobalt-700">
                2
              </span>
              <div>
                <strong>Answer before you talk to anyone.</strong> If you and Ern
                discuss it first, we&apos;ve lost the point.
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4 border border-neutral-100">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobalt-100 text-xs font-bold text-cobalt-700">
                3
              </span>
              <div>
                <strong>
                  Your answers will be shown side by side with everyone
                  else&apos;s
                </strong>
                , without names, when we meet.
              </div>
            </li>
            <li className="flex items-start gap-3 rounded-xl bg-neutral-50 p-4 border border-neutral-100">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cobalt-100 text-xs font-bold text-cobalt-700">
                4
              </span>
              <div>
                <strong>One question at the end is private</strong> — only Paul
                sees it. It&apos;s marked clearly when you get there.
              </div>
            </li>
          </ul>

          <div className="rounded-xl border border-neutral-200/60 bg-neutral-50/50 p-3.5 text-center text-sm text-neutral-600">
            Taglish is completely fine. Write it how you&apos;d actually say it.
          </div>
        </section>

        <div className="mt-8 border-t border-neutral-100 pt-6">
          <GroundRulesForm />
        </div>
      </div>
    </main>
  );
}