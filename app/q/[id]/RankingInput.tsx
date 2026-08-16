"use client";

import { useMemo, useState } from "react";
import { APP_IDS, type AppId } from "@/lib/questions";
import {
  APP_LABELS,
  shufflePool,
  type RankingDraft,
} from "@/lib/ranking";

// Tap-to-assign ranking input (F03-T07, FR-10, ui_ux.md §4.7, §7) for Q8.
//
// Q8 is the hard one on mobile. Drag-and-drop on touch is fragile and no drag
// library is permitted (ui_ux §4.7, AGENTS.md), so the ranking is built by
// tapping: tappable pool cards, each tap moves one card into an ordered list
// with its position number, and an ✕ returns it to the pool and renumbers the
// remainder. Pool order is randomised per respondent (ui_ux §4.7: "a fixed
// order subtly signals a default ranking") — deterministically seeded from the
// respondent's id (see `seed`), so it differs between respondents and is stable
// for a single one across reloads.
//
// Keyboard is a first-class path (ui_ux §7): every interaction is a button,
// radio or textarea, so the whole thing is tab-reachable, and the ordered list
// carries explicit up/down controls as an alternative to tapping. Position
// changes are announced through a `role="status"` live region so a screen
// reader hears the renumbering.
//
// The same screen also collects the delete-one radio with its one-line why, and
// an initially collapsed "predict the group" control — a second, independent
// tap-to-assign ranking. The persisted §3.1 shape is `{ rank, delete, why,
// predicted }`; "answered" is the shell's job, derived from the emitted draft.

const reasonFieldClass =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900 focus:outline-none focus:ring-2 focus:ring-neutral-400";

export function RankingInput({
  value,
  onChange,
  seed,
}: {
  /** Existing value to seed the fields (empty until persistence exists). */
  value?: RankingDraft;
  onChange: (value: RankingDraft) => void;
  /** Per-respondent seed for the deterministic pool shuffle. */
  seed: string;
}) {
  const [draft, setDraft] = useState<RankingDraft>(() => ({
    rank: value?.rank ?? [],
    delete: value?.delete ?? null,
    why: value?.why ?? "",
    predicted: value?.predicted ?? [],
  }));
  const [predictedOpen, setPredictedOpen] = useState(false);

  function setField(update: (current: RankingDraft) => RankingDraft) {
    setDraft((current) => {
      const next = update(current);
      onChange(next);
      return next;
    });
  }

  // The main pool and the prediction pool are two independent orderings, each
  // seeded from the same respondent id so both are per-respondent but neither
  // is a fixed default for the cohort.
  const poolOrder = useMemo(() => shufflePool(seed), [seed]);
  const predictedPoolOrder = useMemo(
    () => shufflePool(`${seed}:predicted`),
    [seed],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="ranking">
      <div>
        <p className="mb-3 text-base font-medium text-neutral-700">
          Tap in order, first to last.
        </p>
        <RankBuild
          poolOrder={poolOrder}
          ordered={draft.rank}
          poolTestId="rank-pool"
          orderedTestId="rank-ordered"
          onOrderedChange={(rank) => setField((d) => ({ ...d, rank }))}
        />
      </div>

      {/* The delete-one radio and its one-line why (baseline Q8). The why is
          required and paired with the delete — "if we had to delete one
          entirely and ship three, which goes? One line why." */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-semibold text-neutral-800">
          If we had to delete one entirely and ship three, which goes?
        </legend>
        {APP_IDS.map((id) => (
          <label
            key={id}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-neutral-300 px-3 py-2.5 text-base text-neutral-800 has-checked:border-neutral-900 has-checked:bg-neutral-50"
          >
            <input
              type="radio"
              name="q8-delete"
              value={id}
              checked={draft.delete === id}
              onChange={() => setField((d) => ({ ...d, delete: id }))}
              className="h-5 w-5 shrink-0 accent-neutral-900"
            />
            <span className="font-medium">{APP_LABELS[id]}</span>
          </label>
        ))}
      </fieldset>

      <div>
        <label
          htmlFor="q8-why"
          className="block text-base font-medium text-neutral-700"
        >
          One line why
        </label>
        <textarea
          id="q8-why"
          rows={2}
          value={draft.why}
          onChange={(e) => setField((d) => ({ ...d, why: e.target.value }))}
          className={`${reasonFieldClass} mt-2`}
        />
      </div>

      {/* The "predict the group" control: collapsed by default, a second,
          independent tap-to-assign ranking that expands on tap (baseline Q8). */}
      <div>
        <button
          type="button"
          onClick={() => setPredictedOpen((open) => !open)}
          aria-expanded={predictedOpen}
          className="text-base font-medium text-neutral-700 underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-500"
        >
          What do you think the group&apos;s #1 will be?
        </button>
        {predictedOpen && (
          <div className="mt-3">
            <RankBuild
              poolOrder={predictedPoolOrder}
              ordered={draft.predicted}
              poolTestId="predicted-pool"
              orderedTestId="predicted-ordered"
              onOrderedChange={(predicted) =>
                setField((d) => ({ ...d, predicted }))
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One tap-to-assign ranking: a pool of tappable cards and an ordered list built
 * by tapping. Tapping a pool card moves it to the end of the order with its
 * position number; ✕ returns it to the pool (the pool is derived as "not yet
 * ordered", so the remaining cards keep their relative random order and the
 * numbering renumbers on its own); up/down controls reorder a card already in
 * the list. Position changes are announced via `role="status"` so a screen
 * reader hears them.
 */
function RankBuild({
  poolOrder,
  ordered,
  poolTestId,
  orderedTestId,
  onOrderedChange,
}: {
  /** The per-respondent idle order the pool derives from. */
  poolOrder: AppId[];
  /** The current ordered list. */
  ordered: AppId[];
  poolTestId: string;
  orderedTestId: string;
  onOrderedChange: (next: AppId[]) => void;
}) {
  const pool = poolOrder.filter((id) => !ordered.includes(id));
  const [announce, setAnnounce] = useState("");

  function assign(id: AppId) {
    const position = ordered.length + 1;
    onOrderedChange([...ordered, id]);
    setAnnounce(`${APP_LABELS[id]} is number ${position}`);
  }

  function remove(id: AppId) {
    onOrderedChange(ordered.filter((x) => x !== id));
    setAnnounce(`${APP_LABELS[id]} returned to the pool`);
  }

  function move(id: AppId, dir: -1 | 1) {
    const i = ordered.indexOf(id);
    const j = i + dir;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    onOrderedChange(next);
    setAnnounce(`${APP_LABELS[id]} is now number ${j + 1}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <ul
        data-testid={poolTestId}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {pool.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => assign(id)}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center rounded-md border border-neutral-300 bg-white px-3 py-2.5 text-base font-medium text-neutral-800 hover:border-neutral-500"
            >
              {APP_LABELS[id]}
            </button>
          </li>
        ))}
      </ul>

      <div>
        <p className="mb-2 text-base font-medium text-neutral-700">
          Your order
        </p>
        <ol
          data-testid={orderedTestId}
          className="flex flex-col gap-2"
        >
          {ordered.map((id, i) => (
            <li
              key={id}
              className="flex min-h-11 items-center gap-2 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2"
            >
              <span className="w-8 shrink-0 text-left text-sm tabular-nums text-neutral-500">
                #{i + 1}
              </span>
              <span className="flex-1 font-medium text-neutral-900">
                {APP_LABELS[id]}
              </span>
              <button
                type="button"
                aria-label={`Move ${APP_LABELS[id]} up`}
                disabled={i === 0}
                onClick={() => move(id, -1)}
                className="h-11 w-11 shrink-0 rounded-md border border-neutral-300 bg-white text-base font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${APP_LABELS[id]} down`}
                disabled={i === ordered.length - 1}
                onClick={() => move(id, 1)}
                className="h-11 w-11 shrink-0 rounded-md border border-neutral-300 bg-white text-base font-semibold text-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${APP_LABELS[id]} from the order`}
                onClick={() => remove(id)}
                className="h-11 w-11 shrink-0 rounded-md border border-neutral-300 bg-white text-base text-neutral-500 hover:text-neutral-900"
              >
                ✕
              </button>
            </li>
          ))}
        </ol>
      </div>

      {/* Announced on assignment, removal and reorder so a screen reader hears
          position changes. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}