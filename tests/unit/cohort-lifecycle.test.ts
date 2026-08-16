import { describe, expect, it } from "vitest";
import {
  parseCohortLevelPin,
  parseCohortStatus,
  resolveServedLevel,
} from "../../lib/cohort-lifecycle";

// F09-T05 — the pure derivation in the cohort lifecycle, unit-tested without a
// database or a request. The parsers normalise the request body to exactly the
// status / pin values the schema stores, and resolveServedLevel is the rule
// that makes a cohort level pin take effect on the next request without a
// redeploy: a pinned L0..L3 wins over the boot default, automatic follows it.

describe("parseCohortStatus", () => {
  it.each(["draft", "open", "closed"])("accepts %s", (value) => {
    expect(parseCohortStatus(value)).toBe(value);
  });

  it.each(["", "OPEN", "archived", "public", "123", null, 0, undefined])(
    "rejects %j as not a lifecycle status",
    (value) => {
      expect(parseCohortStatus(value)).toBeNull();
    },
  );
});

describe("parseCohortLevelPin", () => {
  it.each(["L0", "L1", "L2", "L3"])("accepts a pinned level %s", (value) => {
    expect(parseCohortLevelPin(value)).toBe(value);
  });

  it("accepts 'auto' for leaving it automatic", () => {
    expect(parseCohortLevelPin("auto")).toBe("auto");
  });

  it.each(["", "l2", "L4", "automatic", "Auto", null, 0, undefined])(
    "rejects %j as not a pin value",
    (value) => {
      expect(parseCohortLevelPin(value)).toBeNull();
    },
  );
});

describe("resolveServedLevel — a cohort pin takes effect on the next request", () => {
  it("a pinned level overrides the boot default", () => {
    // Local/preview default is L2; pinning L0 must win without a redeploy.
    expect(resolveServedLevel("L2", "L0")).toBe("L0");
    expect(resolveServedLevel("L2", "L3")).toBe("L3");
    expect(resolveServedLevel("auto", "L1")).toBe("L1");
  });

  it("a null pin (automatic) falls back to the boot level", () => {
    expect(resolveServedLevel("L2", null)).toBe("L2");
    expect(resolveServedLevel("auto", null)).toBe("auto");
  });

  it("an unrecognised stored value is treated as automatic, not fabricated", () => {
    // Stored pins are validated on write, but a corrupt value must not surface
    // a bogus level; it degrades to the boot default.
    expect(resolveServedLevel("L2", "L9")).toBe("L2");
    expect(resolveServedLevel("auto", "garbage")).toBe("auto");
  });
});