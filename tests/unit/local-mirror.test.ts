import { describe, expect, it } from "vitest";
import {
  MIRROR_STORAGE_KEY,
  clearMirror,
  markMirroredSynced,
  mirrorAnswer,
  readMirror,
  readPendingMirroredAnswers,
  type MirrorStore,
} from "../../lib/local-mirror";

// Local mirror and offline mode (F04-T03). The mirror is the recovery source
// when the browser drops offline: every change is written to localStorage as
// unsynced, a confirmed server save marks it synced, a reconnect drains the
// still-unsynced entries, and submit empties the whole mirror.
//
// The load-bearing rules under test:
//   * marking synced is idempotent and only ever transitions false → true;
//   * a reconnect reader yields exactly the unsynced, structurally-valid
//     answers — never an already-synced one and never a partial draft;
//   * q14(d)'s private note is never written to localStorage (the strip in
//     mirrorAnswer), so it cannot leak out of the active session;
//   * clearMirror empties the storage for submit.
//
// These are pure functions over a Storage-like object, so a simple in-memory
// fake stands in for localStorage (vitest runs node, not a browser).

function makeStore(): MirrorStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const Q1 = "q1";
const Q1_VALUE = { text: "The assessment queue is the bottleneck today." };
const Q14_VALUE = {
  wants: ["product"],
  others: { "t-1": "finance" },
  hours: 20,
  private_note: "I may need to step back.",
};

describe("mirrorAnswer", () => {
  it("writes the answer as unsynced on every change", () => {
    const store = makeStore();
    mirrorAnswer(store, Q1, Q1_VALUE, null);
    mirrorAnswer(store, Q1, { text: "Edited." }, 4);

    const entry = readMirror(store)[Q1];
    expect(entry?.value).toEqual({ text: "Edited." });
    expect(entry?.confidence).toBe(4);
    expect(entry?.synced).toBe(false);
  });

  it("keeps other questions' entries while updating one", () => {
    const store = makeStore();
    mirrorAnswer(store, "q1", { text: "One" }, null);
    mirrorAnswer(store, "q2", { who: "centers", because: "no records" }, null);

    const mirror = readMirror(store);
    expect(Object.keys(mirror)).toHaveLength(2);
    expect(mirror.q1?.value).toEqual({ text: "One" });
    expect(mirror.q2?.value).toEqual({ who: "centers", because: "no records" });
  });

  it("never writes q14(d)'s private note to the mirror", () => {
    const store = makeStore();
    mirrorAnswer(store, "q14", Q14_VALUE, null);

    // The note is absent from the stored value, and it never appears anywhere
    // in the serialized localStorage (the real acceptance is that no plaintext
    // copy of Q14(d) survives beyond the active session).
    const entry = readMirror(store).q14;
    expect(entry?.value).toEqual({
      wants: ["product"],
      others: { "t-1": "finance" },
      hours: 20,
    });
    expect(entry?.value).not.toHaveProperty("private_note");
    expect(store.getItem(MIRROR_STORAGE_KEY)).not.toContain("step back");
  });

  it("leaves non-q14 answers untouched through the mirror", () => {
    const store = makeStore();
    mirrorAnswer(store, "q13", { text: "We ran out of money.", cause: "costs" }, null);
    expect(readMirror(store).q13?.value).toEqual({
      text: "We ran out of money.",
      cause: "costs",
    });
  });
});

describe("markMirroredSynced", () => {
  it("marks a mirrored answer synced", () => {
    const store = makeStore();
    mirrorAnswer(store, Q1, Q1_VALUE, null);
    markMirroredSynced(store, Q1);
    expect(readMirror(store)[Q1]?.synced).toBe(true);
  });

  it("does nothing for an unknown question", () => {
    const store = makeStore();
    markMirroredSynced(store, "q15");
    expect(readMirror(store)).toEqual({});
  });
});

describe("readPendingMirroredAnswers", () => {
  it("yields only unsynced, structurally valid answers", () => {
    const store = makeStore();
    // synced → excluded.
    mirrorAnswer(store, "q1", { text: "Already saved." }, null);
    markMirroredSynced(store, "q1");
    // unsynced + valid → included.
    mirrorAnswer(store, "q2", { who: "centers", because: "no records" }, 3);
    // unsynced + invalid shape → excluded (partial draft stands aside).
    mirrorAnswer(store, "q8", {
      rank: ["pedconnect"],
      delete: null,
      why: "",
      predicted: [],
    }, null);

    const pending = readPendingMirroredAnswers(store);
    expect(pending).toEqual([
      {
        question_id: "q2",
        value: { who: "centers", because: "no records" },
        confidence: 3,
      },
    ]);
  });

  it("never returns a q14 public-fields entry, because the note-stripped shape is invalid", () => {
    // The q14 mirror entry carries only the public fields (no private_note), so
    // it cannot form a §3.1 shape and must not be pushed to the server — the
    // drain path observes the same privacy line as the write path.
    const store = makeStore();
    mirrorAnswer(store, "q14", Q14_VALUE, null);
    expect(readPendingMirroredAnswers(store)).toEqual([]);
  });

  it("returns an empty list when nothing has been mirrored", () => {
    expect(readPendingMirroredAnswers(makeStore())).toEqual([]);
  });
});

describe("clearMirror", () => {
  it("empties the storage so submit leaves nothing on the device", () => {
    const store = makeStore();
    mirrorAnswer(store, "q1", { text: "One" }, null);
    mirrorAnswer(store, "q14", Q14_VALUE, null);
    clearMirror(store);
    expect(readMirror(store)).toEqual({});
    expect(store.getItem(MIRROR_STORAGE_KEY)).toBeNull();
  });
});

describe("corrupt mirror data", () => {
  it("reads as empty rather than throwing into the save path", () => {
    const store = makeStore();
    store.setItem(MIRROR_STORAGE_KEY, "{not json");
    expect(readMirror(store)).toEqual({});
    expect(readPendingMirroredAnswers(store)).toEqual([]);
  });
});