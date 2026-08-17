"use client";

import { useState } from "react";
import {
  emptyPairedRowsDraft,
  PAIRED_ROWS_STAR_NOTE,
  type PairedRowsDraft,
} from "@/lib/paired-rows";

// Paired-rows + star input (F03-T08, FR-10, ui_ux.md §4.10) for Q11.
//
// Three repeating blocks, each a "What" and a "Done when" — the done-condition
// has to be a number, a date or something you could point at, "improve
// onboarding" is not done-able (baseline Q11). A single star is a radio across
// all three blocks, not a checkbox (ui_ux §4.10): picking block one's star and
// then block two's clears block one by construction, and the screen explains
// that with an inline note that reads as a *reason*, not as a validation
// error — the star is optional, so nothing has failed.
//
// Only the first block is required; blocks two and three are optional, which
// quietly discourages padding to three (ui_ux §4.10). The shell derives both
// "answered" and the forward decision from the draft the component emits.

const fieldClass =
  "w-full min-h-[48px] rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-base text-neutral-900 shadow-sm transition-all focus:border-cobalt-600 focus:outline-none focus:ring-2 focus:ring-cobalt-500/20";

const BLOCK_INDICES = [0, 1, 2] as const;

export function PairedRowsInput({
  value,
  onChange,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: PairedRowsDraft;
  onChange: (value: PairedRowsDraft) => void;
}) {
  const [draft, setDraft] = useState<PairedRowsDraft>(() => ({
    rocks: value?.rocks ?? emptyPairedRowsDraft().rocks,
    starred: value?.starred ?? null,
  }));
  const [starNoteVisible, setStarNoteVisible] = useState(false);

  function setDraftAndReport(next: PairedRowsDraft) {
    setDraft(next);
    onChange(next);
  }

  function setRock(
    index: 0 | 1 | 2,
    key: "what" | "done_when",
    text: string,
  ) {
    const rocks = draft.rocks.map((rock, i) =>
      i === index ? { ...rock, [key]: text } : rock,
    ) as PairedRowsDraft["rocks"];
    setDraftAndReport({ ...draft, rocks });
  }

  function chooseStar(index: 0 | 1 | 2) {
    // A second star selection (a different block was already starred) clears
    // the first by radio construction; surface the reason note on that change.
    if (draft.starred !== null && draft.starred !== index) {
      setStarNoteVisible(true);
    }
    setDraftAndReport({ ...draft, starred: index });
  }

  return (
    <div className="flex flex-col gap-6" data-testid="paired-rows">
      {BLOCK_INDICES.map((index) => {
        const rock = draft.rocks[index];
        const whatId = `q11-what-${index}`;
        const doneId = `q11-done-${index}`;
        return (
          <fieldset
            key={index}
            className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-card sm:p-6"
          >
            <legend className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-500">
              Priority {index + 1}
            </legend>

            <div className="mt-2 flex flex-col gap-4">
              <div>
                <label
                  htmlFor={whatId}
                  className="block text-sm font-semibold text-neutral-800 mb-1.5"
                >
                  What
                </label>
                <input
                  id={whatId}
                  type="text"
                  value={rock.what}
                  // Block one is required; blocks two and three are optional
                  // (ui_ux §4.10) — the shell's answered check is the gate, and
                  // this attribute mirrors it for the required block.
                  required={index === 0}
                  onChange={(e) => setRock(index, "what", e.target.value)}
                  className={fieldClass}
                />
              </div>

              <div>
                <label
                  htmlFor={doneId}
                  className="block text-sm font-semibold text-neutral-800 mb-1.5"
                >
                  Done when
                </label>
                <input
                  id={doneId}
                  type="text"
                  value={rock.done_when}
                  required={index === 0}
                  onChange={(e) =>
                    setRock(index, "done_when", e.target.value)
                  }
                  className={fieldClass}
                />
              </div>

              {/* The star is a radio across all three blocks (ui_ux §4.10): one
                  shared name groups them, so choosing a second clears the
                  first by construction — never a checkbox, never two stars. */}
              <label className="flex min-h-[48px] cursor-pointer items-center gap-3.5 rounded-xl border border-neutral-200 px-4 py-3 text-sm font-medium text-neutral-800 transition-all hover:border-cobalt-300 hover:bg-cobalt-50/20 has-checked:border-cobalt-600 has-checked:bg-cobalt-50/50 has-checked:text-cobalt-950 shadow-subtle mt-1">
                <input
                  type="radio"
                  name="q11-star"
                  value={index}
                  checked={draft.starred === index}
                  onChange={() => chooseStar(index)}
                  className="h-4 w-4 shrink-0 text-cobalt-600 focus:ring-cobalt-500 accent-cobalt-600"
                />
                <span className="font-semibold">
                  ☆ This is the most important one
                </span>
              </label>
            </div>
          </fieldset>
        );
      })}

      {/* The reason note surfaces only when a star replaces a previous one; it
          is microcopy, not an error (ui_ux §4.10, AGENTS.md "copy is code"). */}
      {starNoteVisible && (
        <p
          data-testid="star-note"
          className="rounded-xl border border-cobalt-200 bg-cobalt-50 p-4 text-sm font-medium text-cobalt-900"
        >
          {PAIRED_ROWS_STAR_NOTE}
        </p>
      )}
    </div>
  );
}