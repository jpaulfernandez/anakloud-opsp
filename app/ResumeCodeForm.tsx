"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The resume-code return entry (F04-T05, FR-4, ui_ux.md §3.2). The anonymous
// landing's second route back into a session: a lapsed respondent types their
// six-character code, it is exchanged for the session cookie by
// /api/session/claim (the same endpoint an invite link uses, and the one that
// enforces the five-attempts-per-IP rate limit), and the respondent is sent
// to wherever their claim points — normally the resume landing, which shows
// "Welcome back, {name}. You're on question N of 15."
//
// Entry is case-insensitive on the server (F02-T03), so nothing here normalises
// the field; the server uppercases and trims. The only client-side gate is a
// non-blank field, and the only messages are neutral: a wrong code and a
// rate-limited IP read as "come back shortly", never a reason the code is bad.
export function ResumeCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = code.trim() !== "" && !submitting;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeCode: code }),
      });

      if (response.status === 429) {
        // Rate limited for the remainder of the hour — the code path refuses,
        // so the respondent is told to wait without hinting the code was right.
        setMessage("Too many tries. Please wait a while and try again.");
        return;
      }

      let data: { ok?: boolean; redirectTo?: string } | null = null;
      try {
        data = (await response.json()) as { ok?: boolean; redirectTo?: string };
      } catch {
        data = null;
      }

      if (response.ok && data?.ok === true && typeof data.redirectTo === "string") {
        router.push(data.redirectTo);
        return;
      }
      setMessage("That code didn't work. Check it and try again.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="resume_code"
          className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1.5"
        >
          Resume code
        </label>
        <input
          id="resume_code"
          name="resume_code"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-center font-mono text-lg tracking-[0.25em] uppercase text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
        />
      </div>
      {message !== null ? (
        <p
          role="status"
          className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center text-xs font-medium text-rose-800"
        >
          {message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-cobalt-600 px-5 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
      >
        Resume
      </button>
    </form>
  );
}