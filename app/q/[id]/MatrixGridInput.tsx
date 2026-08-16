"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  Q5_ROLE_IDS,
  type Q5Value,
  type RoleId,
} from "@/lib/questions";
import {
  Q5_COLUMNS,
  Q5_COLUMN_LABELS,
  Q5_ROLE_LABELS,
  toggleRole,
} from "@/lib/matrix-grid";

// Matrix-grid input (F03-T05, FR-10, ui_ux.md §4.8) for Q5.
//
// Q5 is a 9×4 grid of checkboxes: nine roles across four columns (Pays us ·
// Decides to adopt · Uses it most days · Benefits most). Nine rows and four
// columns of checkboxes does not fit a phone, so the grid pivots to column-
// major on narrow viewports: one column per screen, four short nine-item
// multi-selects, with a "1 of 4" sub-progress indicator that does not touch the
// shell's 15-question progress (the four screens are all Q5, not four new
// questions). On wide viewports it is the true grid with sticky headers and
// full-row hover highlight — and the pivoted form is offered as an explicit
// toggle on desktop too, because §7 names the pivot the accessible path on all
// screen sizes, not just mobile.
//
// Both presentations edit the same four role-id arrays and both go through
// `toggleRole`, so "both presentations write identical payloads for identical
// selections" (F03-T05 acceptance) holds by construction: the arrays are kept
// in registry order and there is no other persistent surface to diverge on.
//
// "Answered" is computed by the shell from the emitted value (any role marked
// in any column — a role may be in none), so this component never blocks or
// decides navigation itself (PR4, D2).

// Below this width the 9×4 grid cannot fit; the pivot is the default.
const PIVOT_BREAKPOINT = 768;

/** True when the viewport is wide enough for the grid (matchMedia snapshot). */
function useIsWide(): boolean {
  const query = `(min-width: ${PIVOT_BREAKPOINT}px)`;
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false, // server snapshot: never claim wide before hydration
  );
}

const rowClass =
  "hover:bg-neutral-50 transition-colors border-b border-neutral-200";

export function MatrixGridInput({
  value,
  onChange,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: Q5Value;
  onChange: (value: Q5Value) => void;
}) {
  // Q5's stored shape (four role-id arrays) is exactly its draft — there are no
  // free-text or number parts to normalise as the metric triple has — so the
  // working state is the same object the component emits.
  const [answer, setAnswer] = useState<Q5Value>(() => ({
    pays: value?.pays ?? [],
    decides: value?.decides ?? [],
    uses: value?.uses ?? [],
    benefits: value?.benefits ?? [],
  }));

  // Presentation choice. "auto" follows the viewport (grid wide, pivot narrow);
  // an explicit toggle pins it so the pivoted form stays available on desktop.
  const [viewPref, setViewPref] = useState<"auto" | "grid" | "pivot">("auto");
  // The pivot's current column screen (0..3). Kept entirely internal so the
  // "1 of 4" sub-progress never becomes part of the shell's progress.
  const [step, setStep] = useState(0);

  const isWide = useIsWide();
  const view =
    viewPref === "auto" ? (isWide ? "grid" : "pivot") : viewPref;

  function mark(column: (typeof Q5_COLUMNS)[number], role: RoleId) {
    setAnswer((current) => {
      const next = toggleRole(current, column, role);
      onChange(next);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="matrix-grid">
      {/* The desktop-grid ⇄ pivot toggle (§7: the pivot is the accessible path
          on all screen sizes, so it is offered explicitly on desktop too). */}
      {isWide && (
        <button
          type="button"
          onClick={() => setViewPref(view === "pivot" ? "grid" : "pivot")}
          className="self-start text-sm font-medium text-neutral-600 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
          aria-pressed={view === "pivot"}
        >
          {view === "pivot"
            ? "Show as one grid"
            : "Show one column at a time"}
        </button>
      )}

      {view === "grid" ? (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-base">
            <thead>
              <tr>
                {/* Sticky header row overlays the role column as the page scrolls. */}
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-white px-3 py-2 text-sm font-medium text-neutral-500"
                >
                  Roles
                </th>
                {Q5_COLUMNS.map((column) => (
                  <th
                    key={column}
                    scope="col"
                    className="sticky top-0 z-10 min-w-28 bg-white px-3 py-2 text-center text-sm font-semibold text-neutral-700"
                  >
                    {Q5_COLUMN_LABELS[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Q5_ROLE_IDS.map((role) => (
                <tr key={role} className={rowClass}>
                  <th
                    scope="row"
                    className="px-3 py-2.5 text-left text-base font-medium text-neutral-800"
                  >
                    {Q5_ROLE_LABELS[role]}
                  </th>
                  {Q5_COLUMNS.map((column) => (
                    <td key={column} className="px-3 py-2.5 text-center">
                      <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
                        <span className="sr-only">
                          {Q5_ROLE_LABELS[role]} — {Q5_COLUMN_LABELS[column]}
                        </span>
                        <input
                          type="checkbox"
                          className="h-5 w-5 accent-neutral-900"
                          checked={answer[column].includes(role)}
                          onChange={() => mark(column, role)}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <PivotView answer={answer} step={step} setStep={setStep} onMark={mark} />
      )}
    </div>
  );
}

/**
 * The column-major pivot: four sequential screens, each a nine-item multi-select
 * for one of the four columns, with a "1 of 4" sub-progress indicator. Fully
 * internal — its own Back/Next move between the four Q5 column screens and
 * never touch the shell's 15-question progress.
 */
function PivotView({
  answer,
  step,
  setStep,
  onMark,
}: {
  answer: Q5Value;
  step: number;
  setStep: (value: number) => void;
  onMark: (column: (typeof Q5_COLUMNS)[number], role: RoleId) => void;
}) {
  const column = Q5_COLUMNS[step];
  const selected = answer[column];

  return (
    <div className="flex flex-col gap-4" data-testid="matrix-pivot">
      {/* Sub-progress: the "1 of 4" is about the four columns inside this one
          question, so it is rendered here and stays off the main progress. */}
      <p
        className="text-sm font-medium text-neutral-500"
        aria-live="polite"
        data-testid="matrix-sub-progress"
      >
        {step + 1} of 4
      </p>
      <p className="text-base font-semibold text-neutral-800">
        Who {Q5_COLUMN_LABELS[column].toLowerCase()}?
      </p>

      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">{Q5_COLUMN_LABELS[column]}</legend>
        {Q5_ROLE_IDS.map((role) => {
          const checked = selected.includes(role);
          return (
            <label
              key={role}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-neutral-300 px-3 py-2.5 text-base text-neutral-800 has-checked:border-neutral-900 has-checked:bg-neutral-50"
            >
              <input
                type="checkbox"
                className="h-5 w-5 shrink-0 accent-neutral-900"
                checked={checked}
                onChange={() => onMark(column, role)}
              />
              <span className="font-medium">{Q5_ROLE_LABELS[role]}</span>
            </label>
          );
        })}
      </fieldset>

      {/* Column-screen navigation. On the last column there is no Next: the
          respondent leaves Q5 via the shell's Continue. */}
      <div className="flex items-center justify-between gap-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="text-base font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
          >
            ← Back
          </button>
        ) : (
          <span />
        )}
        {step < Q5_COLUMNS.length - 1 && (
          <button
            type="button"
            onClick={() => setStep(step + 1)}
            className="rounded-md bg-neutral-900 px-4 py-2 text-base font-semibold text-white hover:bg-neutral-700"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}