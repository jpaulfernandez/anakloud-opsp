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
    <form onSubmit={handleSubmit}>
      <label htmlFor="display_name">Your name</label>
      <input
        id="display_name"
        name="display_name"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor="email">Email (optional)</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <p id="email-note">so we can resend your link if you lose it</p>

      <button type="submit" disabled={!canContinue}>
        Continue
      </button>
    </form>
  );
}