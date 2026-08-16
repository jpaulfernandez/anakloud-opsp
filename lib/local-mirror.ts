import type { QuestionId, Q14Value } from "./questions";
import { isValidAnswerShape } from "./answer-shape";

// Local mirror and offline mode (F04-T03, ui_ux.md §6, tech_infrastructure.md
// §2).
//
// Every answer state change is mirrored here to localStorage before the
// debounced write reaches the server (useAutosave does the write; this module
// is the recovery source). When the browser drops offline, the mirror keeps the
// typed answers so navigation between screens cannot lose them, and when
// connectivity returns they are drained back to the server without respondent
// action. One entry per question sits under a single localStorage key so the
// whole mirror clears in one removeItem call (submit empties it — F04-T03
// acceptance: "localStorage is cleared on submit").
//
// The privacy rule (AGENTS.md): Q14(d)'s private note is never written to
// localStorage. The mirror strips `private_note` from a q14 value the same way
// upsertAnswer splits it to its own is_private row (F01-T03). The consequence
// is deliberate: an offline q14(d) note is not retained across a reconnect —
// it is lost rather than persisted as plaintext in the browser. Privacy wins
// over offline retention here, exactly as it does everywhere in this product.
//
// Every function takes a Storage-like store so the module is unit-testable in
// node without a browser; the browser callers pass `localStorage`. Access from
// the client components is confined to effects and event callbacks, never
// render, so the SSR pass never touches the store.

export const MIRROR_STORAGE_KEY = "align:answer-mirror";

/** One question's entry in the mirror. */
export interface MirroredAnswer {
  /** The §3.1 stored shape; q14's `private_note` is stripped (see above). */
  value: unknown;
  confidence: number | null;
  /** False while the server has not confirmed this answer (offline). */
  synced: boolean;
}

type Mirror = Record<string, MirroredAnswer | undefined>;

/** One question awaiting a PATCH, ready to send to /api/answers. */
export interface PendingAnswer {
  question_id: string;
  value: unknown;
  confidence: number | null;
}

/** The slice of Storage the mirror needs, injectable for unit tests. */
export type MirrorStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readMirror(store: MirrorStore): Mirror {
  const raw = store.getItem(MIRROR_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Mirror;
    }
  } catch {
    // A corrupt mirror reads as empty rather than throwing into the save path.
    // The next write replaces it wholesale.
  }
  return {};
}

function writeMirror(store: MirrorStore, mirror: Mirror): void {
  store.setItem(MIRROR_STORAGE_KEY, JSON.stringify(mirror));
}

/** Mirror the current answer state, marking it unsynced until the server
    confirms. Called on every change (F04-T03). */
export function mirrorAnswer(
  store: MirrorStore,
  questionId: QuestionId,
  value: unknown,
  confidence: number | null,
): void {
  const mirror = readMirror(store);
  mirror[questionId] = {
    value: stripPrivateNote(questionId, value),
    confidence,
    synced: false,
  };
  writeMirror(store, mirror);
}

/** Mark a question as confirmed on the server, so it is no longer pending. */
export function markMirroredSynced(
  store: MirrorStore,
  questionId: QuestionId,
): void {
  const mirror = readMirror(store);
  const entry = mirror[questionId];
  if (entry && !entry.synced) {
    entry.synced = true;
    writeMirror(store, mirror);
  }
}

/** Unsynced answers that are structurally valid §3.1 shapes, ready to PATCH.
    The q14 stripped value never matches a valid shape, so it is never sent —
    the private-note guarantee held in the drain path too. */
export function readPendingMirroredAnswers(
  store: MirrorStore,
): PendingAnswer[] {
  const mirror = readMirror(store);
  const pending: PendingAnswer[] = [];
  for (const [questionId, entry] of Object.entries(mirror)) {
    if (!entry || entry.synced) continue;
    if (!isValidAnswerShape(questionId as QuestionId, entry.value)) continue;
    pending.push({
      question_id: questionId,
      value: entry.value,
      confidence: entry.confidence,
    });
  }
  return pending;
}

/** Empty the mirror (submit calls this so the browser holds no answer state). */
export function clearMirror(store: MirrorStore): void {
  store.removeItem(MIRROR_STORAGE_KEY);
}

/** Remove q14(d)'s private note from a mirrored value — it is never written
    here, matching the layer that splits it to its own is_private row. */
function stripPrivateNote(questionId: QuestionId, value: unknown): unknown {
  if (questionId !== "q14" || value === null || typeof value !== "object") {
    return value;
  }
  const { private_note: privateNote, ...publicFields } = value as Q14Value &
    object;
  // The note is dropped (not merely blanked); only the public fields may live
  // in the browser mirror.
  void privateNote;
  return publicFields;
}