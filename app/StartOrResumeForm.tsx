"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ResumeCodeForm } from "./ResumeCodeForm";

/** Helper to extract a token from either raw text or a pasted full URL */
function extractToken(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes("token=")) {
    try {
      const url = trimmed.startsWith("http")
        ? new URL(trimmed)
        : new URL(trimmed, "http://localhost");
      const token = url.searchParams.get("token");
      if (token) return token;
    } catch {
      const match = trimmed.match(/[?&]token=([^&#\s]+)/);
      if (match) return match[1];
    }
  }
  return trimmed;
}

export function StartOrResumeForm() {
  const [tab, setTab] = useState<"start" | "resume">("start");
  const [tokenInput, setTokenInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const canSubmitToken = tokenInput.trim() !== "" && !submitting;

  async function handleStartNew(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmitToken) return;
    setSubmitting(true);
    setMessage(null);

    const token = extractToken(tokenInput);

    try {
      const response = await fetch("/api/session/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

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
      setMessage("That invite link or token wasn't found or has expired.");
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 8-point Segmented Tab Controls */}
      <div
        role="tablist"
        aria-label="Start new or resume questionnaire"
        className="grid grid-cols-2 rounded-xl border border-neutral-200 bg-neutral-100 p-1 shadow-subtle"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === "start"}
          onClick={() => {
            setTab("start");
            setMessage(null);
          }}
          className={`flex min-h-[40px] items-center justify-center rounded-lg text-sm font-semibold transition-all ${
            tab === "start"
              ? "bg-white text-cobalt-700 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          Start new
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "resume"}
          onClick={() => {
            setTab("resume");
            setMessage(null);
          }}
          className={`flex min-h-[40px] items-center justify-center rounded-lg text-sm font-semibold transition-all ${
            tab === "resume"
              ? "bg-white text-cobalt-700 shadow-sm"
              : "text-neutral-600 hover:text-neutral-900"
          }`}
        >
          Resume
        </button>
      </div>

      {tab === "start" ? (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Get started
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Paste the link from your invite, or type the token.
            </p>
          </div>

          <form onSubmit={handleStartNew} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="invite_token"
                className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 mb-1.5"
              >
                Invite link or token
              </label>
              <input
                id="invite_token"
                name="invite_token"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20"
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
              disabled={!canSubmitToken}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-cobalt-600 px-5 py-3 text-base font-semibold text-white shadow-cobalt transition-all hover:bg-cobalt-700 active:scale-[0.98] active:bg-cobalt-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            >
              Open my questionnaire
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-sm font-semibold text-neutral-900">
              Been here before?
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">
              Enter your 6-character resume code to pick up where you left off.
            </p>
          </div>
          <ResumeCodeForm />
        </div>
      )}
    </div>
  );
}
