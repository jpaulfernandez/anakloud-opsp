"use client";

import { useState } from "react";
import type { ComparisonAnswerAnonymised } from "@/lib/comparison";
import type { DivergenceCategory } from "@/lib/divergence";
import type { QuestionId } from "@/lib/questions";
import AnalysisPanel from "./AnalysisPanel";
import ComparisonBoard from "./ComparisonBoard";

// F14-T03 — the comparison screen's coordination point for the analysis side
// panel (FR-32, ui_ux.md §4.19). The panel must open beside the raw answers
// and never replace or obscure them, so the layout decision lives here: the
// board and the panel are grid siblings, the board first in source order, and
// the panel only forces a two-column split at the lg breakpoint. At every
// viewport width the answers column is present and never covered by an
// overlay — on narrow screens the panel stacks *below* the board, and at wide
// widths the `1fr` answer column and the fixed 360px panel share a row. That
// is the "answers stay on screen next to the analysis at all times" acceptance
// rendered as layout rather than as an overlay modal.

interface QuestionComparisonProps {
  questionId: QuestionId;
  section: string;
  questionText: string;
  badge: {
    category: DivergenceCategory | "manual review";
    label: string;
  } | null;
  initialAnswers: ComparisonAnswerAnonymised[];
}

export default function QuestionComparison({
  questionId,
  section,
  questionText,
  badge,
  initialAnswers,
}: QuestionComparisonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          data-testid="open-analysis-panel"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          {open ? "Close analysis" : "Analyse"}
        </button>
      </div>
      <div
        className={
          open
            ? "mt-3 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]"
            : "mt-3"
        }
      >
        <ComparisonBoard
          questionId={questionId}
          section={section}
          questionText={questionText}
          badge={badge}
          initialAnswers={initialAnswers}
        />
        {open ? <AnalysisPanel questionId={questionId} /> : null}
      </div>
    </>
  );
}