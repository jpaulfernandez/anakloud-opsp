import type {
  ProjectionBadgeCategory,
  ProjectionQuestion,
} from "@/lib/projection";

// F10-T06 — the projection sheet render (FR-34, ui_ux.md §4.18). The export the
// facilitator projects during the session. Its whole job is legibility at
// projector distance: larger type than the comparison board, question blocks
// that keep their cards together, and the deterministic divergence badge so the
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
  aligned: "bg-emerald-50 text-emerald-800",
  "soft split": "bg-amber-50 text-amber-800",
  "hard split": "bg-red-50 text-red-800",
  "manual review": "bg-neutral-100 text-neutral-700",
};

export default function ProjectionSheet({
  questions,
}: {
  questions: ProjectionQuestion[];
}) {
  return (
    <main
      data-testid="projection-sheet"
      className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6"
    >
      <div
        data-testid="projection-meta"
        className="mb-8 border-b border-neutral-300 pb-4"
      >
        <div className="text-sm uppercase tracking-widest text-neutral-500">
          Projection sheet
        </div>
        <h1 className="mt-1 text-[22px] font-semibold leading-snug text-neutral-900 md:text-[28px]">
          How six people answer the same questions
        </h1>
        <p
          data-testid="projection-anonymised-note"
          className="mt-2 text-lg text-neutral-600"
        >
          Anonymised. No names. Order is not meaningful.
        </p>
      </div>

      <ol className="flex flex-col gap-10">
        {questions.map((question) => (
          <li
            key={question.questionId}
            data-testid={`projection-question-${question.questionId}`}
            className="border-b border-neutral-200 pb-8 last:border-b-0"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm uppercase tracking-wide text-neutral-500">
                  Q{question.questionId.replace("q", "")} · {question.section}
                </div>
                <h2 className="mt-1 text-[20px] leading-snug font-semibold text-neutral-900 md:text-[26px]">
                  {question.text}
                </h2>
              </div>
              {question.badge !== null ? (
                <span
                  data-testid="projection-badge"
                  className={`inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-base font-semibold ${BADGE_STYLE[question.badge.category]}`}
                >
                  {question.badge.label}
                </span>
              ) : null}
            </div>

            {question.answers.length === 0 ? (
              <p className="mt-4 text-lg text-neutral-500">
                No one has answered this question yet.
              </p>
            ) : (
              <ul
                data-testid={`projection-answers-${question.questionId}`}
                className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {question.answers.map((answer, i) => (
                  <li
                    key={i}
                    data-testid="projection-card"
                    className="flex break-inside-avoid flex-col rounded-lg border border-neutral-300 bg-white p-4"
                  >
                    <p
                      data-testid="projection-answer-text"
                      className="whitespace-pre-line text-[17px] leading-relaxed text-neutral-900"
                    >
                      {answer.text}
                    </p>
                    {answer.confidence !== null ? (
                      <div
                        data-testid="projection-confidence"
                        className="mt-3 border-t border-neutral-200 pt-2 text-base text-neutral-500"
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