"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The ground-rules acknowledgement form (F02-T05, FR-5, ui_ux.md §4.2).
//
// Client-side so the "Got it" checkbox can gate the Continue button without a
// round trip. The acknowledgement is recorded once and shown once: a POST that
// succeeds moves the respondent to their session destination, and the server
// refuses to re-show the screen once the timestamp is set. Nothing about an
// already-checked box hints at what the answer should be — the four points are
// statements to accept, not a choice to make.
export function GroundRulesForm() {
  const router = useRouter();
  const [gotIt, setGotIt] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canContinue = gotIt && !submitting;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinue) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/respondent/self/ground-rules", {
        method: "POST",
      });
      if (response.ok) {
        router.push("/");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        <input
          type="checkbox"
          checked={gotIt}
          onChange={(e) => setGotIt(e.target.checked)}
        />
        Got it
      </label>

      <button type="submit" disabled={!canContinue}>
        Continue
      </button>
    </form>
  );
}