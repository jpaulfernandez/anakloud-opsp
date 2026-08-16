// Sync conflict resolution (F04-T04, ui_ux.md §6): server wins on lock status,
// local wins on answer content, and typed text is never silently discarded.
// This is the pure decision the autosave loop hands the UI — no I/O, no
// network, so it unit- and property-tests exhaustively and the property test
// (interleaved local/server sequences) can prove the no-content-loss guarantee.

/** One respondent's local working state for a single question. */
export interface LocalConflictState {
  /** The latest locally-typed answer value, or null/undefined when there is
      none distinct to preserve (a fetch never overwrites local content). */
  value: unknown;
  /** True when `value` differs from the last value the server confirmed —
      the respondent has content the server does not yet hold. */
  unsaved: boolean;
}

/** What the server reports about the respondent's answers. */
export interface ServerConflictState {
  /** True when the answers are immutable (the respondent has submitted). */
  locked: boolean;
}

/**
 * The single state the question screen must settle into after a disagreement:
 *
 * - `{ locked: false }` — the server is unlocked, so local content wins and
 *   proceeds down the normal save path. Nothing to surface.
 * - `{ locked: true, preserve }` — the server has locked answers (the
 *   respondent submitted in another tab). The lock wins; `preserve` carries
 *   the unsaved local text so the UI can surface it read-only rather than drop
 *   it without the respondent's knowledge. It is null when local content is
 *   not actually unsaved (nothing distinct would be lost).
 */
export type SyncResolution =
  | { locked: false }
  | { locked: true; preserve: unknown | null };

export function resolveSyncConflict(
  local: LocalConflictState,
  server: ServerConflictState,
): SyncResolution {
  if (!server.locked) return { locked: false };
  return {
    locked: true,
    preserve: local.unsaved ? local.value : null,
  };
}