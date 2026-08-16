"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isValidAnswerShape } from "./answer-shape";
import type { QuestionId } from "./questions";
import {
  markMirroredSynced,
  mirrorAnswer,
  readPendingMirroredAnswers,
} from "./local-mirror";
import {
  resolveSyncConflict,
  type SyncResolution,
} from "./sync-conflict";

// Debounced autosave with a persistent save slot (F04-T02, FR-7, ui_ux.md D4,
// §6).
//
// One hook per mounted question screen — which is all the questionnaire needs,
// because a screen shows exactly one question (FR-6). It debounces changes to
// the answer, persists the latest value via PATCH /api/answers (F04-T01), and
// exposes `flush()` for the shell to call just before navigating, so a keystroke
// typed in the last few hundred milliseconds is not dropped. It also flushes
// with a keepalive request on page hide, because a respondent can leave a
// screen by closing the tab or going "Back" (a full page load) on a phone.
//
// Save state is the persistent §4.3 slot: "Saving…" while a save is in flight,
// "✓ Saved" once one has settled, and nothing until the first is needed. There
// is deliberately no "failed" surface — a failure keeps the latest answer in
// memory, schedules a retry, and stays on "Saving…" (honest: still attempting),
// never an error that implies the answer was lost (ui_ux §6). Answering never
// blocks on a failing save: `flush` issues the latest save without awaiting it,
// so Continue proceeds while the write completes in the background.
//
// The sent value is the canonical stored shape (see storableAnswerValue); the
// hook re-guards it with `isValidAnswerShape` so a partial structured draft
// (a ranking with no delete choice, a metric triple with no number) is never
// persisted, and stands aside until it becomes a real answer.

export type SaveState = "saving" | "saved" | "locked";

const DEFAULT_DEBOUNCE_MS = 600;
const RETRY_MS = 4000;

/** What one PATCH attempt returned. `network` is any transient failure worth
    retrying; `locked` is the server refusing a write because the respondent
    has submitted (PR5), which no retry can ever fix. */
type SendResult =
  | { ok: true }
  | { ok: false; reason: "network" }
  | { ok: false; reason: "locked" };

/** Deep (but plain) equality for JSON-like answer values, ignoring object
    identity — a re-created Q14 `others` map with the same content must not
    count as a change. */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    a === null ||
    typeof b !== "object" ||
    b === null
  ) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const av = a as unknown[];
    const bv = b as unknown[];
    return (
      av.length === bv.length && av.every((item, i) => valuesEqual(item, bv[i]))
    );
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key) =>
        key in (b as Record<string, unknown>) &&
        valuesEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}

/** The value that was last confirmed saved on the server (or the mount value,
    so an untouched screen never reads as dirty). */
interface SavedSnapshot {
  value: unknown;
  confidence: number | null;
}

export function useAutosave({
  questionId,
  value,
  confidence,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: {
  questionId: QuestionId;
  /** The current stored-shape answer value (see storableAnswerValue). */
  value: unknown;
  confidence: number | null;
  debounceMs?: number;
}) {
  const [saveState, setSaveState] = useState<SaveState | null>(null);

  // F04-T04: once the server reports this question locked (a 409 on PATCH), it
  // can never succeed again, so the hook stops retrying and remembers the
  // conflict so the shell can surface the unsaved text read-only. Locked is
  // terminal for the mounted question — the server won, and all we can do is
  // keep the typed text visible rather than silently discard it.
  const [lockConflict, setLockConflict] = useState<SyncResolution | null>(null);
  const lockedRef = useRef(false);

  const questionIdRef = useRef(questionId);
  questionIdRef.current = questionId;

  // The latest committed answer, read synchronously by every send so a flush
  // never dispatches a stale value captured in an old render's closure.
  const latestRef = useRef<SavedSnapshot>({ value, confidence });
  latestRef.current = { value, confidence };

  const lastSavedRef = useRef<SavedSnapshot | null>(null);
  // Initialise to the mount value: F04-T02 has no hydration yet, so the first
  // value the hook sees is the empty answer and there is nothing to save.
  if (lastSavedRef.current === null) {
    lastSavedRef.current = { value, confidence };
  }

  const runningRef = useRef<Promise<void> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PATCH one answer. Takes the question id explicitly so the same writer can
  // drain mirrored answers for other screens on reconnect (F04-T03), not only
  // the question this hook instance is mounted for. Never throws: a network
  // failure and a 409 lock (PR5) are different outcomes, and the caller has to
  // tell them apart — the loop retries the former and accepts the latter.
  const send = useCallback(
    async (
      qid: QuestionId,
      toSend: SavedSnapshot,
      keepalive = false,
    ): Promise<SendResult> => {
      let res: Response;
      try {
        res = await fetch("/api/answers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          keepalive,
          body: JSON.stringify({
            question_id: qid,
            value: toSend.value,
            ...(toSend.confidence != null
              ? { confidence: toSend.confidence }
              : {}),
          }),
        });
      } catch {
        return { ok: false, reason: "network" };
      }
      if (!res.ok) {
        // 409 is the server reporting answers locked (PR5), never a transient
        // condition. Distinguish the two so the loop stops instead of hammering
        // a lock that cannot change client-side (F04-T04: server wins on lock).
        let locked = false;
        try {
          const body = (await res.json()) as { locked?: boolean };
          locked = body.locked === true;
        } catch {
          // A non-JSON error body (e.g. a 500 proxy page) is transient.
        }
        return { ok: false, reason: locked ? "locked" : "network" };
      }
      return { ok: true };
    },
    [],
  );

  // True when the current answer is a storable shape that differs from what was
  // last confirmed saved.
  const dirty = useCallback(() => {
    const latest = latestRef.current;
    if (!isValidAnswerShape(questionIdRef.current, latest.value)) return false;
    const last = lastSavedRef.current;
    return (
      last === null ||
      last.confidence !== latest.confidence ||
      !valuesEqual(last.value, latest.value)
    );
  }, []);

  const latestIs = useCallback(
    (candidate: SavedSnapshot) =>
      valuesEqual(latestRef.current.value, candidate.value) &&
      latestRef.current.confidence === candidate.confidence,
    [],
  );

  // The serialized save loop: sends the latest dirty value, retrying on failure
  // without dropping the in-memory answer and without a busy spin, and stops the
  // moment nothing is dirty. Only one loop runs; a caller during a running loop
  // just lets it pick up the newest value on its next pass. A 409 (locked) stops
  // the loop permanently — the server has won on lock status and no retry can
  // succeed — and hands the conflict to the UI so the unsaved text is surfaced
  // read-only rather than silently discarded (F04-T04).
  const trigger = useCallback(() => {
    if (lockedRef.current) return;
    if (runningRef.current) return runningRef.current;
    const task = (async () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      while (dirty()) {
        const target = latestRef.current;
        setSaveState("saving");
        const result = await send(questionIdRef.current, target);
        if (result.ok) {
          if (latestIs(target)) {
            lastSavedRef.current = target;
            // A confirmed save settles the mirror entry for this question so a
            // later reconnect does not re-send it (F04-T03).
            if (typeof localStorage !== "undefined") {
              markMirroredSynced(localStorage, questionIdRef.current);
            }
          }
          continue;
        }
        if (result.reason === "locked") {
          // The save loop only runs while `dirty()`, so the content being sent
          // is genuinely unsaved. Server wins on lock; keep the typed text so
          // the shell can surface it read-only, then stop retrying forever.
          lockedRef.current = true;
          setLockConflict(
            resolveSyncConflict(
              { value: latestRef.current.value, unsaved: true },
              { locked: true },
            ),
          );
          setSaveState("locked");
          return;
        }
        // Network failure: retain the answer (it stays in latestRef), keep
        // accepting input, and retry after a pause. Never an error implying
        // data loss.
        await new Promise<void>((resolve) => {
          retryTimerRef.current = setTimeout(resolve, RETRY_MS);
        });
        retryTimerRef.current = null;
      }
      setSaveState("saved");
    })();
    runningRef.current = task.finally(() => {
      runningRef.current = null;
    });
    return runningRef.current;
  }, [dirty, send, latestIs]);

  // Latest trigger, reached through a ref so effects and listeners can call it
  // without tripping exhaustive-deps (it reads only refs and stable setters).
  const triggerRef = useRef(trigger);
  triggerRef.current = trigger;

  // Debounce on change: any storable edit reschedules a save after a quiet gap.
  useEffect(() => {
    if (lockedRef.current) return;
    if (!isValidAnswerShape(questionIdRef.current, value)) return;
    const last = lastSavedRef.current;
    if (
      last !== null &&
      last.confidence === confidence &&
      valuesEqual(last.value, value)
    ) {
      return;
    }
    setSaveState("saving");
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      triggerRef.current();
    }, debounceMs);
  }, [value, confidence, debounceMs]);

  // Flush any pending save ahead of navigation. Not awaited: Continue must
  // never be gated on a save succeeding (ui_ux §6). The loop dispatch is
  // synchronous, so the request is on the wire before the transition.
  const flush = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    triggerRef.current();
  }, []);

  // A keepalive flush for leaving the page entirely (Back is a full page load;
  // phones kill backgrounded tabs). Best-effort — done before unload completes.
  // Skips a locked question: the 409 cannot be fixed by a final attempt.
  const keepaliveFlushRef = useRef(() => {});
  keepaliveFlushRef.current = () => {
    if (dirty() && !lockedRef.current) {
      void send(questionIdRef.current, latestRef.current, true);
    }
  };

  useEffect(() => {
    const hide = () => keepaliveFlushRef.current();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pagehide", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // --- F04-T03: local mirror and offline mode ---
  //
  // Reflect the true network state on mount without a hydration mismatch: the
  // first render always reports "online" (server and client agree), and this
  // mount effect corrects it from navigator.onLine in the browser. There is no
  // state the app hides behind offline — it answers identically and just shows
  // the reassurance slot instead of "✓ Saved". `localStorage` is only touched
  // inside this effect and the callbacks, never during render.
  const [offline, setOffline] = useState<boolean>(false);

  // Drain every unsynced mirrored answer to the server. Fires on reconnect
  // (fire-and-forget): a failed PATCH leaves the entry pending for the next
  // reconnect. Overlapping with the current screen's own retry loop is fine —
  // the endpoint upserts, so re-sending the same value is idempotent.
  const flushPending = useCallback(async () => {
    if (typeof localStorage === "undefined") return;
    for (const pending of readPendingMirroredAnswers(localStorage)) {
      const result = await send(pending.question_id as QuestionId, {
        value: pending.value,
        confidence: pending.confidence,
      });
      if (result.ok) {
        markMirroredSynced(localStorage, pending.question_id as QuestionId);
      } else if (result.reason === "locked") {
        // The server has locked this respondent's answers, so no pending write
        // can ever succeed. Leave the entries mirrored (their text is
        // preserved, never silently discarded) and stop trying.
        break;
      }
      // Network failure: keep the entry pending for the next reconnect.
    }
  }, [send]);

  const flushPendingRef = useRef(flushPending);
  flushPendingRef.current = flushPending;
  // Only flush on a real offline → online transition, not on initial mount —
  // draining the whole mirror on every page load is F04-T05's restore scope.
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    const goOffline = () => {
      wasOfflineRef.current = true;
      setOffline(true);
    };
    const backOnline = () => {
      setOffline(false);
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        void flushPendingRef.current();
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", backOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", backOnline);
    };
  }, []);

  // Mirror the current answer on every change (after the mount value) so an
  // offline jump between screens or a tab kill cannot lose it. Skipping the
  // mount render means revisiting a question without editing it never re-mirrors
  // an empty draft over a saved answer.
  const mountedRef = useRef(false);
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    mirrorAnswer(localStorage, questionIdRef.current, value, confidence);
  }, [value, confidence]);

  return { saveState, flush, offline, lockConflict };
}