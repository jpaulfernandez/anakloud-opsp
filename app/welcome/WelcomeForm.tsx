"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The name-entry form (F02-T04, FR-2, ui_ux.md §4.1). Client-side so Continue
// is gated on a non-blank name without a round trip — an empty name leaves the
// button disabled, and nothing else about the name is checked (FR-2's SHALL
// NOT on validating language, script or spelling). The email is secondary and
// optional, accompanied by the one-line reason it exists. On a successful save
// the respondent advances to the ground-rules screen (F02-T05, ui_ux.md §4.2),
// the gate in front of the first question.
export function WelcomeForm({
  initialName,
  initialEmail,
}: {
  initialName: string;
  initialEmail: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [submitting, setSubmitting] = useState(false);

  const canContinue = name.trim() !== "" && !submitting;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canContinue) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/respondent/self", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      if (response.ok) {
        router.push("/ground-rules");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <label
          htmlFor="display_name"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          Your name
        </label>
        <input
          id="display_name"
          name="display_name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
        />
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-sm font-semibold text-neutral-800 mb-1.5"
        >
          Email (optional)
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
        />
        <p id="email-note" className="mt-1.5 text-xs text-neutral-500">
          so we can resend your link if you lose it
        </p>
      </div>

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