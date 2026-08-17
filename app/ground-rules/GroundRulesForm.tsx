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
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <label className="flex min-h-[52px] cursor-pointer items-center gap-3.5 rounded-xl border border-neutral-200 bg-white p-4 shadow-subtle transition-all hover:border-cobalt-300 hover:bg-cobalt-50/20 has-checked:border-cobalt-600 has-checked:bg-cobalt-50/40">
        <input
          type="checkbox"
          checked={gotIt}
          onChange={(e) => setGotIt(e.target.checked)}
          className="h-5 w-5 rounded-md border-neutral-300 text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
        />
        <span className="text-base font-semibold text-neutral-900">
          Got it
        </span>
      </label>

      <button
        type="submit"
        disabled={!canContinue}
        className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-cobalt-600 px-6 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        Continue
      </button>
    </form>
  );
}