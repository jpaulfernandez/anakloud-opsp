import { describe, expect, it } from "vitest";
import {
  buildSnapshotPayload,
  publicSnapshotEntries,
  type SnapshotPayload,
} from "../../lib/submit";
import type { OwnAnswerRow } from "../../lib/answers";

// F06-T03 snapshot payload — pure, no I/O. `buildSnapshotPayload` freezes every
// answer row the way POST /api/submit does, carrying each entry's private flag
// so the q14d note is inside the frozen record yet still excluded downstream
// (publicSnapshotEntries) at the payload level, not in a template.

const ROW_DATE = new Date("2026-08-17T00:00:00Z");

function row(partial: Omit<OwnAnswerRow, "updated_at">): OwnAnswerRow {
  return { ...partial, updated_at: ROW_DATE };
}

describe("buildSnapshotPayload", () => {
  it("freezes every answer row, tagged with its private and confidence state", () => {
    const payload = buildSnapshotPayload([
      row({
        question_id: "q1",
        value: { text: "Movement data is locked inside notebooks." },
        confidence: null,
        is_private: false,
      }),
      row({
        question_id: "q7",
        value: { text: "the only system built for PH clinics" },
        confidence: 4,
        is_private: false,
      }),
    ]);

    expect(payload.q1).toEqual({
      value: { text: "Movement data is locked inside notebooks." },
      confidence: null,
      is_private: false,
    });
    expect(payload.q7).toEqual({
      value: { text: "the only system built for PH clinics" },
      confidence: 4,
      is_private: false,
    });
  });

  it("carries the q14 private note inside the frozen record, marked private", () => {
    const payload = buildSnapshotPayload([
      row({
        question_id: "q14",
        value: { wants: ["product"], others: {}, hours: 20 },
        confidence: null,
        is_private: false,
      }),
      row({
        question_id: "q14d",
        value: { private_note: "I may need to leave in six months." },
        confidence: null,
        is_private: true,
      }),
    ]);

    // The note is present in the frozen baseline of record ...
    expect(payload.q14d?.value).toEqual({
      private_note: "I may need to leave in six months.",
    });
    expect(payload.q14d?.is_private).toBe(true);

    // ... yet the downstream public view drops it at the payload level.
    const publicView: SnapshotPayload = Object.fromEntries(
      publicSnapshotEntries(payload),
    );
    expect(publicView.q14d).toBeUndefined();
    expect(publicView.q14).toBeDefined();
  });

  it("excludes every private entry from the public view", () => {
    const payload = buildSnapshotPayload([
      row({ question_id: "q3", value: { metric: "centers", value: 40, unit: "per year" }, confidence: 2, is_private: false }),
      row({ question_id: "q14d", value: { private_note: "note" }, confidence: null, is_private: true }),
      row({ question_id: "q15", value: { text: "Maya shipped it." }, confidence: null, is_private: false }),
    ]);
    const publicView: SnapshotPayload = Object.fromEntries(
      publicSnapshotEntries(payload),
    );
    expect(Object.keys(publicView)).toEqual(["q3", "q15"]);
  });
});