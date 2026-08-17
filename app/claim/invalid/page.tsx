import type { Metadata } from "next";

// The single neutral screen for an unusable invite (F02-T01). It is shown for
// an unknown token, a revoked token, and a token on a closed cohort alike, and
// deliberately discloses none of the three — the reason would tell a would-be
// intruder that a specific link used to work. The respondent only learns the
// link is not valid any more and where to get a fresh one.

export const metadata: Metadata = {
  title: "Link invalid",
};

export default function ClaimInvalidPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200/80 bg-white p-8 shadow-card text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
          This link isn&apos;t valid any more.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Please ask the facilitator for a fresh link.
        </p>
      </div>
    </main>
  );
}