import { readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { admitsAdmin, type AdminAdmission } from "../../lib/auth";
import type { ResolvedSession } from "../../lib/session";

// F09-T01 — the admin gate. Two layers are asserted here without a database or
// a request: the *decision* (admitsAdmin, extracted as a pure function for
// exactly this reason) and the *wiring* (every /api/admin/* route passes through
// requireAdminSession, and no bypass flag lets an unsubmitted or non-facilitator
// through). The live HTTP refusal — an unsubmitted facilitator and a submitted
// non-facilitator both hitting a real admin route over the wire — lives in
// tests/e2e/unlock.spec.ts, which needs a database.

const authSource = () => readFileSync(resolve(process.cwd(), "lib", "auth.ts"), "utf8");

/** Every route handler under app/api/admin, deepest first. */
function adminRouteSources(): Array<{ rel: string; src: string }> {
  const root = resolve(process.cwd(), "app", "api", "admin");
  const out: Array<{ rel: string; src: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry === "route.ts") {
        out.push({
          rel: full.slice(root.length + 1),
          src: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(root);
  return out;
}

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

describe("F09-T01 — admitsAdmin is the pure admission decision", () => {
  it.each<[string, ResolvedSession | null, AdminAdmission]>([
    ["no session at all is unauthenticated", null, "unauthenticated"],
    [
      "an unsubmitted facilitator is forbidden",
      session({ isFacilitator: true, submittedAt: null }),
      "forbidden",
    ],
    [
      "a submitted non-facilitator is forbidden",
      session({ isFacilitator: false, submittedAt: new Date() }),
      "forbidden",
    ],
    [
      "an unsubmitted non-facilitator is forbidden",
      session({ isFacilitator: false, submittedAt: null }),
      "forbidden",
    ],
    [
      "a submitted facilitator is allowed",
      session({ isFacilitator: true, submittedAt: new Date() }),
      "allowed",
    ],
  ])("%s", (_label, s, expected) => {
    expect(admitsAdmin(s)).toBe(expected);
  });

  it("allows only when both halves hold: facilitator AND submitted", () => {
    // Both conditions independently, so neither is a soft gate.
    expect(admitsAdmin(session({ isFacilitator: false, submittedAt: new Date() }))).toBe(
      "forbidden",
    );
    expect(admitsAdmin(session({ isFacilitator: true, submittedAt: null }))).toBe("forbidden");
  });
});

describe("F09-T01 — the gate is the single authorisation point for every admin route", () => {
  const routes = adminRouteSources();

  it("finds at least one admin route to police", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("every admin route passes through requireAdminSession, not requireApiSession", () => {
    for (const { rel, src } of routes) {
      expect(src, `/api/admin/${rel} must use requireAdminSession`).toMatch(
        /requireAdminSession/,
      );
      // A route must not drop to the weaker per-route gate: going around
      // requireAdminSession would re-introduce a bespoke check a later route
      // could forget.
      expect(src, `/api/admin/${rel} must not bypass the shared gate`).not.toMatch(
        /requireApiSession/,
      );
    }
  });

  it("the gate refuses a session it does not admit, only after the shared 401", () => {
    const src = authSource();
    expect(src).toMatch(/requireAdminSession/);
    expect(src).toMatch(/admitsAdmin/);
    // It delegates identity resolution to the shared requireApiSession so the
    // 401 and the DB-backed session read are the same for admin and respondent.
    expect(src).toMatch(/requireApiSession/);
  });
});

describe("F09-T01 — no bypass flag", () => {
  it("the gate never reads a request header, body or query parameter to admit", () => {
    const src = authSource();
    // Admission must come from the DB-resolved session, not from anything a
    // client can set. If a bypass flag were added it would have to read one of
    // these.
    expect(src).not.toMatch(/request\.headers|req\.headers/);
    expect(src).not.toMatch(/request\.json|req\.json/);
    expect(src).not.toMatch(/searchParams|URLSearchParams/);
  });

  it("the gate consults no environment variable, so no env flag can turn it off", () => {
    const src = authSource();
    // The admission decision reads only the DB-resolved session. Any env read
    // inside auth.ts would be a new switch; there are none.
    expect(src).not.toMatch(/process\.env/);
  });
});