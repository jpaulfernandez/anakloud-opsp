"use client";

import { useEffect, useState } from "react";
import {
  ATTRIBUTED_CONFIRM_MESSAGE,
  comparisonAnswerText,
  shuffleAnswers,
} from "@/lib/comparison-screen";
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
  aligned: "bg-emerald-50 text-emerald-800",
  "soft split": "bg-amber-50 text-amber-800",
  "hard split": "bg-red-50 text-red-800",
  "manual review": "bg-neutral-100 text-neutral-700",
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
      const res = await fetch(
        `/api/admin/question/${questionId}?mode=attributed`,
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
    <>
      <header className="mt-1 border-b border-neutral-200 pb-3">
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          Q{questionId.replace("q", "")} · {section}
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <h1 className="text-[19px] leading-snug font-semibold text-neutral-900 md:text-[24px]">
            {questionText}
          </h1>
          {badge !== null ? (
            <span
              data-testid="divergence-badge"
              className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${BADGE_STYLE[badge.category]}`}
            >
              {badge.label}
            </span>
          ) : null}
        </div>
      </header>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Comparison mode"
          data-testid="comparison-mode-toggle"
          className="inline-flex items-center overflow-hidden rounded-full border border-neutral-200 bg-white"
        >
          <button
            type="button"
            data-testid="mode-attributed"
            data-active={mode === "attributed"}
            onClick={requestAttributed}
            className={`px-3 py-1 text-xs font-medium ${
              mode === "attributed"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            Attributed
          </button>
          <button
            type="button"
            data-testid="mode-anonymised"
            data-active={mode === "anonymised"}
            onClick={switchToAnonymised}
            className={`px-3 py-1 text-xs font-medium ${
              mode === "anonymised"
                ? "bg-neutral-900 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
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
          className="mt-3 rounded-md border border-neutral-300 bg-neutral-50 p-4"
        >
          <p
            data-testid="attributed-confirm-message"
            className="text-sm font-medium text-neutral-900"
          >
            {ATTRIBUTED_CONFIRM_MESSAGE}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="attributed-confirm-yes"
              disabled={loading}
              onClick={confirmAttributed}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              Show names
            </button>
            <button
              type="button"
              data-testid="attributed-confirm-no"
              disabled={loading}
              onClick={keepAnonymised}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700"
            >
              Keep anonymised
            </button>
          </div>
        </div>
      )}

      {attributedError !== null && (
        <p data-testid="attributed-error" className="mt-3 text-sm text-red-700">
          {attributedError}
        </p>
      )}

      {isEmpty ? (
        <p className="mt-6 text-neutral-500">
          No one has answered this question yet.
        </p>
      ) : (
        <ul
          data-testid="comparison-grid"
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
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
                className="flex h-full flex-col rounded-md border border-neutral-200 bg-white p-3"
              >
                {mode === "attributed" && (
                  <div
                    data-testid="answer-name"
                    className="mb-1.5 border-b border-neutral-100 pb-1 text-xs font-semibold text-neutral-900"
                  >
                    {name}
                  </div>
                )}
                <p
                  data-testid="answer-text"
                  className="flex-1 whitespace-pre-line text-[13px] leading-relaxed text-neutral-800"
                >
                  {comparisonAnswerText(questionId, value, true)}
                </p>
                {confidence !== null ? (
                  <div
                    data-testid="answer-confidence"
                    className="mt-2 border-t border-neutral-100 pt-1.5 text-xs text-neutral-500"
                  >
                    Confidence {confidence}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}