import { describe, expect, it } from "vitest";
import { adminPageView, type AdminPageView } from "../../lib/admin";
import { admitsAdmin, type AdminAdmission } from "../../lib/auth";
import type { ResolvedSession } from "../../lib/session";

// F09-T02 — the admin page's view decision and how it relates to the F09-T01
// admission gate. adminPageView is the pure decision that decides which of the
// three states the /admin page renders (away / locked / dashboard) before the
// component touches anything rendered; it is asserted exhaustively here so the
// locked state is guaranteed to be the only state an unsubmitted facilitator
// can reach, and so no respondent ever lands on the dashboard.

function session(overrides: Partial<ResolvedSession>): ResolvedSession {
  return {
    respondentId: "20000000-0000-0000-0000-000000000001",
    cohortId: "10000000-0000-0000-0000-000000000001",
    isFacilitator: true,
    submittedAt: new Date("2026-08-17T00:00:00Z"),
    readOnly: false,
    ...overrides,
  };
}

describe("F09-T02 — adminPageView is the exhaustive locked-state decision", () => {
  it.each<[string, ResolvedSession | null, AdminPageView]>([
    ["no session at all is sent away", null, "away"],
    [
      "an unsubmitted facilitator is locked",
      session({ isFacilitator: true, submittedAt: null }),
      "locked",
    ],
    [
      "a submitted facilitator reaches the dashboard",
      session({ isFacilitator: true, submittedAt: new Date() }),
      "dashboard",
    ],
    [
      "a non-facilitator is sent away even when submitted",
      session({ isFacilitator: false, submittedAt: new Date() }),
      "away",
    ],
    [
      "an unsubmitted non-facilitator is sent away too",
      session({ isFacilitator: false, submittedAt: null }),
      "away",
    ],
  ])("%s", (_label, s, expected) => {
    expect(adminPageView(s)).toBe(expected);
  });

  it("every state that the api gate forbids is never the dashboard", () => {
    // Cross-check against the F09-T01 admission function: any session the
    // gate refuses (unauthenticated / forbidden) must not map to the dashboard
    // view, and the only view that admits to the dashboard is the one the
    // gate allows. This pins the UI and the API gate to the same rule without
    // either drifting.
    const cases: Array<[ResolvedSession | null, AdminAdmission]> = [
      [null, "unauthenticated"],
      [session({ isFacilitator: true, submittedAt: null }), "forbidden"],
      [session({ isFacilitator: false, submittedAt: new Date() }), "forbidden"],
      [session({ isFacilitator: false, submittedAt: null }), "forbidden"],
    ];
    for (const [s, admission] of cases) {
      const view = adminPageView(s);
      expect(view).not.toBe("dashboard");
      expect(admitsAdmin(s)).toBe(admission);
    }
    // And the inverse: the one admitted session is exactly the dashboard view.
    const admitted = session({ isFacilitator: true, submittedAt: new Date() });
    expect(admitsAdmin(admitted)).toBe("allowed");
    expect(adminPageView(admitted)).toBe("dashboard");
  });
});