import { describe, expect, it } from "vitest";
import {
  isProvidedDisplayName,
  normalizeDisplayName,
  welcomeDestination,
} from "../../lib/respondent";

// F02-T04 name-entry rules, verified without a database. The two load-bearing
// rules here are "name is required (non-blank)" and "nothing else is checked" —
// FR-2's SHALL NOT on validating language, script or spelling means any
// non-whitespace way of writing a name is acceptable, exactly as candidly as
// someone might type it. welcomeDestination is the pure half of the claim
// redirect decision.

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

describe("welcomeDestination (F02-T04)", () => {
  it("sends a respondent with no name to name entry", () => {
    expect(welcomeDestination("")).toBe("/welcome");
    expect(welcomeDestination("   ")).toBe("/welcome");
    expect(welcomeDestination(null)).toBe("/welcome");
    expect(welcomeDestination(undefined)).toBe("/welcome");
  });

  it("sends a respondent with a name straight to the session restore", () => {
    expect(welcomeDestination("Ana Reyes")).toBe("/");
  });
});