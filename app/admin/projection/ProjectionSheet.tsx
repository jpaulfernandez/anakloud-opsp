import type {
  ProjectionBadgeCategory,
  ProjectionQuestion,
} from "@/lib/projection";

// F10-T06 — the projection sheet render (FR-34, ui_ux.md §4.18). The export the
// facilitator projects during the session. Its whole job is legibility at
// projector distance: larger type than the comparison board, question blocks
// cards together, and the deterministic divergence badge so the
// verdict reads at a glance. There is deliberately no mode toggle and no
// identity — the sheet is anonymised by construction (lib/projection.ts), and
// this component is a pure server render of the ProjectionQuestion blocks the
// page builds. The print stylesheet (F08-T01 conventions, app/globals.css)
// strips the screen chrome and keeps a card from splitting across a page
// break, so the projected sheet and the printed one are the same content.
//
// "A page break may fall between sections but never through one" (F08-T01):
// here the atomic unit is one answer card, and each carries break-inside: avoid
// so no single answer splits across a page boundary — the projection analogue
// of the OPSP cell rule.
const BADGE_STYLE: Record<ProjectionBadgeCategory, string> = {
  aligned: "bg-emerald-50 text-emerald-800 border border-emerald-200/80",
  "soft split": "bg-amber-50 text-amber-800 border border-amber-200/80",
  "hard split": "bg-rose-50 text-rose-800 border border-rose-200/80",
  "manual review": "bg-neutral-100 text-neutral-700 border border-neutral-200/80",
};

export default function ProjectionSheet({
  questions,
}: {
  questions: ProjectionQuestion[];
}) {
  return (
    <main
      data-testid="projection-sheet"
      className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6"
    >
      <div
        data-testid="projection-meta"
        className="mb-10 rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8"
      >
        <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-cobalt-50 px-3 py-0.5 text-xs font-semibold uppercase tracking-wider text-cobalt-700">
          Projection sheet
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900 sm:text-3xl">
          How six people answer the same questions
        </h1>
        <p
          data-testid="projection-anonymised-note"
          className="mt-2 text-base leading-relaxed text-neutral-600"
        >
          Anonymised. No names. Order is not meaningful.
        </p>
      </div>

      <ol className="flex flex-col gap-10">
        {questions.map((question) => (
          <li
            key={question.questionId}
            data-testid={`projection-question-${question.questionId}`}
            className="rounded-2xl border border-neutral-200/80 bg-white p-6 shadow-card sm:p-8"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-neutral-100 pb-4">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-wider text-cobalt-600">
                  Q{question.questionId.replace("q", "")} · {question.section}
                </div>
                <h2 className="mt-1 text-xl font-bold leading-snug text-neutral-900 sm:text-2xl">
                  {question.text}
                </h2>
              </div>
              {question.badge !== null ? (
                <span
                  data-testid="projection-badge"
                  className={`inline-flex shrink-0 items-center rounded-full px-3.5 py-1 text-xs font-bold uppercase tracking-wider ${BADGE_STYLE[question.badge.category]}`}
                >
                  {question.badge.label}
                </span>
              ) : null}
            </div>

            {question.answers.length === 0 ? (
              <p className="mt-6 text-base text-neutral-500 italic">
                No one has answered this question yet.
              </p>
            ) : (
              <ul
                data-testid={`projection-answers-${question.questionId}`}
                className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {question.answers.map((answer, i) => (
                  <li
                    key={i}
                    data-testid="projection-card"
                    className="flex break-inside-avoid flex-col justify-between rounded-xl border border-neutral-200/80 bg-neutral-50/60 p-4 shadow-subtle"
                  >
                    <p
                      data-testid="projection-answer-text"
                      className="whitespace-pre-line text-sm leading-relaxed text-neutral-900"
                    >
                      {answer.text}
                    </p>
                    {answer.confidence !== null ? (
                      <div
                        data-testid="projection-confidence"
                        className="mt-3 border-t border-neutral-200/60 pt-2 text-xs font-semibold text-neutral-400"
                      >
                        Confidence {answer.confidence}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}