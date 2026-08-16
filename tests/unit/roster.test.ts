import { describe, expect, it } from "vitest";
import {
  buildRosterEntry,
  ROSTER_TOTAL_QUESTIONS,
  rosterLastActiveAt,
  rosterStatus,
  rosterTimeSpentSeconds,
  type RosterRawRow,
} from "../../lib/roster";
import { QUESTION_IDS } from "../../lib/questions";

// F09-T03 — the pure roster derivation, asserted without a database. The three
// acceptances "no answer text in the payload", "status transitions for a
// respondent who starts then submits", and "unlock events visible with actor
// and timestamp" are pinned here at the rule level; the SQL path that proves
// the payload carries no answer text lives in the DB-gated integration test
// (roster.integration.test.ts) and the rendered DOM in tests/e2e/roster.spec.ts.

const NOW = new Date("2026-08-17T12:00:00Z");
const START = new Date("2026-08-16T09:00:00Z");
const LAST_EDIT = new Date("2026-08-16T11:30:00Z");

function raw(overrides: Partial<RosterRawRow> = {}): RosterRawRow {
  return {
    respondentId: "20000000-0000-0000-0000-000000000001",
    name: "Ana Reyes",
    isFacilitator: false,
    submittedAt: null,
    answeredPublic: 0,
    firstActivityAt: null,
    lastActivityAt: null,
    unlockedAt: null,
    unlockedByName: null,
    now: NOW,
    ...overrides,
  };
}

describe("F09-T03 — roster status transitions", () => {
  it("maps a respondent who starts then submits: not started → in progress → submitted", () => {
    // Freshly claimed, no answers yet.
    expect(rosterStatus(null, 0)).toBe("not_started");
    // They answer a question — no longer not started only once they have data.
    expect(rosterStatus(null, 1)).toBe("in_progress");
    expect(rosterStatus(null, 8)).toBe("in_progress");
    // Submission wins over everything.
    expect(rosterStatus(new Date(), 8)).toBe("submitted");
  });

  it("an unlocked respondent returns to in progress", () => {
    // F06-T05 clears submitted_at but the answers remain.
    expect(rosterStatus(null, 15)).toBe("in_progress");
  });
});

describe("F09-T03 — last active", () => {
  it("is the later of the last edit and the submission", () => {
    expect(rosterLastActiveAt(null, null)).toBeNull();
    expect(rosterLastActiveAt(null, LAST_EDIT)?.getTime()).toBe(LAST_EDIT.getTime());
    // A submission after the last edit is the true last activity.
    const submitted = new Date("2026-08-17T10:00:00Z");
    expect(rosterLastActiveAt(submitted, LAST_EDIT)?.getTime()).toBe(
      submitted.getTime(),
    );
    // An edit after a (theoretically later) submission wins.
    const editedLater = new Date("2026-08-17T12:05:00Z");
    expect(rosterLastActiveAt(submitted, editedLater)?.getTime()).toBe(
      editedLater.getTime(),
    );
  });
});

describe("F09-T03 — time spent", () => {
  it("is the span from first activity to submission", () => {
    const submitted = new Date("2026-08-16T12:00:00Z");
    // 09:00 → 12:00 = 10800 seconds.
    expect(rosterTimeSpentSeconds(submitted, START, NOW)).toBe(10800);
  });

  it("is the span to now while still in progress", () => {
    // 16 Aug 09:00 → 17 Aug 12:00 (NOW) = 27 hours = 97200 seconds.
    expect(rosterTimeSpentSeconds(null, START, NOW)).toBe(97200);
  });

  it("is null when there is no activity to measure", () => {
    expect(rosterTimeSpentSeconds(null, null, NOW)).toBeNull();
    // A submission with no answers (cannot happen) still has nothing to span.
    expect(rosterTimeSpentSeconds(new Date(), null, NOW)).toBeNull();
  });

  it("never reports negative time", () => {
    // An answer timestamped in the future (clock skew) floors to zero.
    const future = new Date("2026-08-18T00:00:00Z");
    expect(rosterTimeSpentSeconds(null, future, NOW)).toBe(0);
  });
});

describe("F09-T03 — buildRosterEntry maps one raw row into the shared payload", () => {
  it("carries identity and progress, and never any answer text", () => {
    const entry = buildRosterEntry(
      raw({ answeredPublic: 5, firstActivityAt: START, lastActivityAt: LAST_EDIT }),
    );
    expect(entry.respondentId).toContain("20000000");
    expect(entry.name).toBe("Ana Reyes");
    expect(entry.status).toBe("in_progress");
    expect(entry.progress).toBe(5);
    expect(entry.total).toBe(ROSTER_TOTAL_QUESTIONS);
    // The questionnaire is the fifteen registered questions.
    expect(ROSTER_TOTAL_QUESTIONS).toBe(QUESTION_IDS.length);
    // There is no field on the entry that could hold answer text.
    expect(Object.keys(entry).sort()).toEqual(
      [
        "respondentId", "name", "status", "progress", "total",
        "lastActiveAt", "timeSpentSeconds", "isFacilitator", "unlock",
      ].sort(),
    );
  });

  it("a submitted respondent maps to submitted with the full progress", () => {
    const submittedAt = new Date("2026-08-16T12:00:00Z");
    const entry = buildRosterEntry(
      raw({ submittedAt, answeredPublic: 15, firstActivityAt: START, lastActivityAt: LAST_EDIT }),
    );
    expect(entry.status).toBe("submitted");
    expect(entry.lastActiveAt?.getTime()).toBe(submittedAt.getTime());
    expect(entry.timeSpentSeconds).toBe(10800);
  });

  it("surfaces an F06-T05 unlock event with actor and timestamp", () => {
    const unlockedAt = new Date("2026-08-17T08:15:00Z");
    const entry = buildRosterEntry(
      raw({ unlockedAt, unlockedByName: "Lia Mendoza", answeredPublic: 15 }),
    );
    expect(entry.unlock).toEqual({ byName: "Lia Mendoza", at: unlockedAt });
    // An unlocked respondent's status reflects the reopened answers.
    expect(entry.status).toBe("in_progress");
  });

  it("has no unlock event for someone never reopened", () => {
    const entry = buildRosterEntry(raw({ answeredPublic: 15 }));
    expect(entry.unlock).toBeNull();
  });

  it("no roster entry is ever the facilitator by accident", () => {
    expect(buildRosterEntry(raw({ isFacilitator: true })).isFacilitator).toBe(true);
    expect(buildRosterEntry(raw({ isFacilitator: false })).isFacilitator).toBe(false);
  });
});