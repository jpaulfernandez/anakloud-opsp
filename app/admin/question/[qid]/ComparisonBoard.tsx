"use client";

import { useEffect, useState } from "react";
import {
  ATTRIBUTED_CONFIRM_MESSAGE,
  comparisonAnswerText,
  shuffleAnswers,
} from "@/lib/comparison-screen";
import { ATTRIBUTE_GRANT_HEADER } from "@/lib/attribute-grant-constants";
import type {
  ComparisonAnswerAnonymised,
  ComparisonAnswerAttributed,
} from "@/lib/comparison";
import type { DivergenceCategory } from "@/lib/divergence";
import type { QuestionId } from "@/lib/questions";

// F10-T04 — the comparison screen's anonymised ⇄ attributed modes (FR-30,
// ui_ux.md §4.18). Anonymised is the default and the safety boundary: it is
// the only mode a page load ever lands in, and in it the card order is
// re-randomised on every load so position cannot infer identity across
// sessions. Attributed mode is opt-in through an explicit confirmation whose
// wording is fixed (the confirmation below), never the result of a single
// click, a remembered preference, or a URL parameter — the mode lives in this
// component's state only, so a reload drops straight back to anonymised.
//
// F14-T05 hardens the confirmation into a server capability: passing it does
// not just flip client state, it POSTs the attribute-grant endpoint and then
// requests the named payload with the returned grant over x-attribute-grant. A
// reload never carries the grant (it is not stored, and it expires in minutes),
// and manipulating the URL alone cannot mint one — so the only way the named
// payload is served at all is through this confirmation-then-grant path.
//
// The server page (page.tsx) renders the anonymised default from the same
// F10-T02 fetch; the client only reaches out to the attributed mode of that
// endpoint once a facilitator has passed the confirmation. The verdict badge
// is deterministic and does not change with mode, so it is passed down and
// rendered as-is.

type Mode = "anonymised" | "attributed";

const BADGE_STYLE: Record<
  DivergenceCategory | "manual review",
  string
> = {
  aligned: "bg-emerald-50 text-emerald-800 border border-emerald-200/80",
  "soft split": "bg-amber-50 text-amber-800 border border-amber-200/80",
  "hard split": "bg-rose-50 text-rose-800 border border-rose-200/80",
  "manual review": "bg-neutral-100 text-neutral-700 border border-neutral-200/80",
};

interface ComparisonBoardProps {
  questionId: QuestionId;
  section: string;
  questionText: string;
  badge: {
    category: DivergenceCategory | "manual review";
    label: string;
  } | null;
  initialAnswers: ComparisonAnswerAnonymised[];
}

interface AttributedPayload {
  ok: boolean;
  answers: ComparisonAnswerAttributed[];
}

export default function ComparisonBoard({
  questionId,
  section,
  questionText,
  badge,
  initialAnswers,
}: ComparisonBoardProps) {
  // Mode is deliberately client-only state: initialising to anonymised and
  // never reading a URL query, cookie or storage means a reload returns to
  // anonymised and no single click or remembered preference can reach
  // attributed (F10-T04).
  const [mode, setMode] = useState<Mode>("anonymised");
  const [confirmAttributedOpen, setConfirmAttributedOpen] = useState(false);
  const [attributed, setAttributed] = useState<
    ComparisonAnswerAttributed[] | null
  >(null);
  const [attributedError, setAttributedError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // The anonymised cards as displayed. Held in state so the shuffle happens
  // after hydration (a render-time shuffle would desync the server and client),
  // and re-drawn fresh on every entry to anonymised mode.
  const [anonOrder, setAnonOrder] =
    useState<ComparisonAnswerAnonymised[]>(initialAnswers);

  // Per-load re-randomisation: every mount (a page load) draws a fresh order
  // in anonymised mode, so position across two visits cannot line up.
  useEffect(() => {
    setAnonOrder(shuffleAnswers(initialAnswers));
  }, [initialAnswers]);

  function requestAttributed() {
    // Opening the confirmation is the only outcome of this click; the mode
    // does not change here.
    setConfirmAttributedOpen(true);
  }

  function keepAnonymised() {
    setConfirmAttributedOpen(false);
  }

  async function confirmAttributed() {
    setConfirmAttributedOpen(false);
    setLoading(true);
    setAttributedError(null);
    try {
      // F14-T05: passing the confirmation first mints a server-issued attribute
      // grant for this question; the named payload is only served with it. The
      // grant is not stored and expires quickly, so a reload or navigation
      // cannot carry it into attributed mode.
      const gRes = await fetch(
        `/api/admin/question/${questionId}/attribute-grant`,
        { method: "POST" },
      );
      if (!gRes.ok) throw new Error("attribute grant failed");
      const { grant } = (await gRes.json()) as { grant?: string };
      if (typeof grant !== "string" || grant === "") {
        throw new Error("attribute grant missing");
      }
      const res = await fetch(
        `/api/admin/question/${questionId}?mode=attributed`,
        { headers: { [ATTRIBUTE_GRANT_HEADER]: grant } },
      );
      if (!res.ok) throw new Error("attributed load failed");
      const json = (await res.json()) as AttributedPayload;
      if (!json.ok || json.answers.length === 0)
        throw new Error("attributed payload empty");
      setAttributed(json.answers);
      setMode("attributed");
    } catch {
      // The recovery for a failed attributed load is to stay anonymised rather
      // than show names based on partial data.
      setAttributedError("Could not load named answers.");
      setMode("anonymised");
    } finally {
      setLoading(false);
    }
  }

  function switchToAnonymised() {
    setMode("anonymised");
    setAttributed(null);
    setAttributedError(null);
    // Re-entering anonymised re-randomises so even within a session position
    // carries no signal.
    setAnonOrder(shuffleAnswers(initialAnswers));
  }

  const displaying = mode === "anonymised" ? anonOrder : attributed;
  const isEmpty =
    displaying === null || (Array.isArray(displaying) && displaying.length === 0);

  return (
    <div className="space-y-6">
      <header className="border-b border-neutral-200 pb-5">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700 mb-2">
          Q{questionId.replace("q", "")} · {section}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">
            {questionText}
          </h1>
          {badge !== null ? (
            <span
              data-testid="divergence-badge"
              className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${BADGE_STYLE[badge.category]}`}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Comparison mode"
          data-testid="comparison-mode-toggle"
          className="inline-flex items-center rounded-xl border border-neutral-200 bg-neutral-100 p-1 shadow-subtle"
        >
          <button
            type="button"
            data-testid="mode-attributed"
            data-active={mode === "attributed"}
            onClick={requestAttributed}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              mode === "attributed"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Attributed
          </button>
          <button
            type="button"
            data-testid="mode-anonymised"
            data-active={mode === "anonymised"}
            onClick={switchToAnonymised}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
              mode === "anonymised"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Anonymised
          </button>
        </div>
        {mode === "anonymised" && !isEmpty && (
          <span
            data-testid="anonymised-hint"
            className="text-xs text-neutral-500"
          >
            Order is randomised every load.
          </span>
        )}
      </div>

      {confirmAttributedOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="attributed-confirm"
          className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 shadow-card"
        >
          <p
            data-testid="attributed-confirm-message"
            className="text-sm font-semibold leading-relaxed text-amber-950"
          >
            {ATTRIBUTED_CONFIRM_MESSAGE}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <button
              type="button"
              data-testid="attributed-confirm-yes"
              disabled={loading}
              onClick={confirmAttributed}
              className="inline-flex min-h-[38px] items-center justify-center rounded-xl bg-cobalt-600 px-4 py-1.5 text-xs font-semibold text-white shadow-cobalt hover:bg-cobalt-700 disabled:opacity-50 transition-all"
            >
              Show names
            </button>
            <button
              type="button"
              data-testid="attributed-confirm-no"
              disabled={loading}
              onClick={keepAnonymised}
              className="inline-flex min-h-[38px] items-center justify-center rounded-xl border border-neutral-300 bg-white px-4 py-1.5 text-xs font-semibold text-neutral-700 shadow-subtle hover:bg-neutral-50 transition-all"
            >
              Keep anonymised
            </button>
          </div>
        </div>
      )}

      {attributedError !== null && (
        <p data-testid="attributed-error" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
          {attributedError}
        </p>
      )}

      {isEmpty ? (
        <div className="rounded-2xl border border-neutral-200/80 bg-white p-8 text-center text-sm text-neutral-500 shadow-card">
          No one has answered this question yet.
        </div>
      ) : (
        <ul
          data-testid="comparison-grid"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {displaying!.map((answer, i) => {
            const attributedAnswer = answer as ComparisonAnswerAttributed;
            const name =
              mode === "attributed" && attributedAnswer.name !== undefined
                ? attributedAnswer.name
                : null;
            const value =
              mode === "attributed"
                ? (answer as ComparisonAnswerAttributed).value
                : (answer as ComparisonAnswerAnonymised).value;
            const confidence =
              mode === "attributed"
                ? (answer as ComparisonAnswerAttributed).confidence
                : (answer as ComparisonAnswerAnonymised).confidence;
            return (
              <li
                key={mode === "attributed" ? attributedAnswer.respondentId : i}
                data-testid="answer-card"
                className="flex h-full flex-col justify-between rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card transition-all hover:border-neutral-300"
              >
                <div>
                  {mode === "attributed" && (
                    <div
                      data-testid="answer-name"
                      className="mb-2 border-b border-neutral-100 pb-2 text-xs font-bold text-cobalt-700 uppercase tracking-wider"
                    >
                      {name}
                    </div>
                  )}
                  <p
                    data-testid="answer-text"
                    className="whitespace-pre-line text-sm leading-relaxed text-neutral-800"
                  >
                    {comparisonAnswerText(questionId, value, true)}
                  </p>
                </div>
                {confidence !== null ? (
                  <div
                    data-testid="answer-confidence"
                    className="mt-4 border-t border-neutral-100 pt-2.5 text-xs font-semibold text-neutral-400"
                  >
                    Confidence {confidence}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}