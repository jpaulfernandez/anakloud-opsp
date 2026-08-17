import {
  CONTAMINATION_GROUPS,
  type ContaminationAudit,
  type ContaminationGroup,
} from "@/lib/contamination";

// F13-T06 — the contamination audit's dashboard surface (spec.md FR-20,
// tech_infrastructure.md §3). A read-only summary for the facilitator once the
// cohort's answers are in: mean agreement rate on the coachable closed
// questions, split by whether the respondents saw an example, a hint, or no
// coach at all. A higher figure in the example-shown column than the uncoached
// column is the signal that coaching pushed answers together — the check that
// tells you whether the "form, never content" principle actually held. It
// carries figures, never answer text (FR-29).

const GROUP_LABEL: Record<ContaminationGroup, string> = {
  "example-shown": "Example shown",
  "hint-only": "Hint only",
  uncoached: "Uncoached",
};

const GROUP_ORDER: readonly ContaminationGroup[] = CONTAMINATION_GROUPS;

/** Show an agreement rate (0..1) as a percentage, or a rule for none. */
function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export default function ContaminationSection({
  audit,
}: {
  audit: ContaminationAudit;
}) {
  // Nothing to compare until someone has answered a coachable question.
  if (audit.questions.length === 0) return null;

  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card">
      <h2
        data-testid="contamination-heading"
        className="text-xs font-bold uppercase tracking-wider text-neutral-500"
      >
        Contamination audit
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-neutral-600">
        Mean agreement rate on the coachable closed questions, by how each
        answer was treated. If the example-shown column is clearly higher than
        the uncoached one, the coach has pushed answers together — the prompt
        needs tightening.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table
          data-testid="contamination-summary"
          className="w-full border-collapse text-sm text-neutral-700"
        >
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="px-3 py-2.5 font-semibold">Group</th>
              <th className="px-3 py-2.5 font-semibold">Mean agreement</th>
              <th className="px-3 py-2.5 font-semibold">Questions scored</th>
            </tr>
          </thead>
          <tbody>
            {GROUP_ORDER.map((group) => (
              <tr key={group} data-testid={`contamination-group-${group}`} className="border-b border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                <td className="px-3 py-2.5 font-semibold text-neutral-900">
                  {GROUP_LABEL[group]}
                </td>
                <td className="px-3 py-2.5 font-medium tabular-nums text-neutral-800">
                  {percent(audit.agreement[group])}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-xs text-neutral-500">
                  {audit.closedQuestions}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}