import { describe, expect, it } from "vitest";
import {
  claimLanding,
  isProvidedDisplayName,
  normalizeDisplayName,
} from "../../lib/respondent";

// F02-T04 / F02-T05 onboarding rules, verified without a database. The two
// load-bearing rules are "name is required (non-blank)" and "nothing else is
// checked" — FR-2's SHALL NOT on validating language, script or spelling means
// any non-whitespace way of writing a name is acceptable, exactly as candidly
// as someone might type it. claimLanding is the pure half of the claim
// redirect decision: it routes a freshly-authenticated respondent through the
// name-entry gate (F02-T04) and the ground-rules gate (F02-T05).

describe("normalizeDisplayName (F02-T04)", () => {
  it("strips surrounding whitespace", () => {
    expect(normalizeDisplayName("  Ana  ")).toBe("Ana");
    expect(normalizeDisplayName("Ana")).toBe("Ana");
  });

  it("collapses whitespace-only input to empty", () => {
    expect(normalizeDisplayName("   ")).toBe("");
    expect(normalizeDisplayName("\t\n")).toBe("");
  });
});

describe("isProvidedDisplayName (F02-T04)", () => {
  it("is false for empty and whitespace-only names", () => {
    expect(isProvidedDisplayName("")).toBe(false);
    expect(isProvidedDisplayName("   ")).toBe(false);
    expect(isProvidedDisplayName("\t")).toBe(false);
  });

  it("is true for an ordinary name", () => {
    expect(isProvidedDisplayName("Ana Reyes")).toBe(true);
    expect(isProvidedDisplayName("Ana")).toBe(true);
  });

  it("does not validate script, spelling or symbols (FR-2 SHALL NOT)", () => {
    // The point of the SHALL NOT: a name is accepted as written, whatever that
    // is in. These are all genuinely valid strings of characters to call
    // yourself; none of them should fail.
    expect(isProvidedDisplayName("Jñgg")).toBe(true);
    expect(isProvidedDisplayName("น้องปู")).toBe(true);
    expect(isProvidedDisplayName("李 明")).toBe(true);
    expect(isProvidedDisplayName("A.2b!")).toBe(true);
    expect(isProvidedDisplayName("12345")).toBe(true);
    // Spelling that is unusual, inconsistent or wrong is still a name.
    expect(isProvidedDisplayName("anna")).toBe(true);
    expect(isProvidedDisplayName("A N A")).toBe(true);
  });
});

describe("claimLanding (F02-T04, F02-T05)", () => {
  it("sends a respondent with no name to name entry", () => {
    expect(claimLanding("", false)).toBe("/welcome");
    expect(claimLanding("   ", false)).toBe("/welcome");
    expect(claimLanding(null, true)).toBe("/welcome");
    expect(claimLanding(undefined, false)).toBe("/welcome");
  });

  it("sends a named respondent who has not acknowledged the ground rules to the ground-rules screen", () => {
    expect(claimLanding("Ana Reyes", false)).toBe("/ground-rules");
  });

  it("restores the session once a name and the acknowledgement are both in place", () => {
    expect(claimLanding("Ana Reyes", true)).toBe("/");
  });
});