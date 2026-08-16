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
    <main>
      <h1>This link isn&apos;t valid any more.</h1>
      <p>Please ask the facilitator for a fresh link.</p>
    </main>
  );
}