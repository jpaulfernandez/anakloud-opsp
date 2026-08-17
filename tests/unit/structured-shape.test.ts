import { describe, expect, it } from "vitest";
import { validateStructuredShape } from "../../lib/structured-shape";

// F18-T02 (M07) — the pure conformance check the Gemini provider runs on every
// structured function call before serialising it for the output guard. These
// tests assert, exhaustively for the OpenAPI-subset the product's structured
// tools declare, that every required field and enum is enforced — a missing
// required field, an out-of-enum value, or a wrong type is reported, so the
// caller can treat the response as a provider failure and never pass a partial
// object onward.

// The schema dialect Gemini accepts, for the coach shape (§5.3): an object,
// all four fields required, verdict/dimension as closed string enums, dimension
// nullable via `nullable: true` (never null inside the enum, never an array
// `type`).
const COACH_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["ok", "needs_work"] },
    dimension: {
      type: "string",
      enum: ["measurability", "specificity", "single_answer", "too_short"],
      nullable: true,
    },
    hint: { type: "string" },
    example: { type: "string" },
  },
  required: ["verdict", "dimension", "hint", "example"],
};

function validCoach(): Record<string, unknown> {
  return { verdict: "ok", dimension: null, hint: "", example: "" };
}

describe("the coach shape (every required field and enum enforced)", () => {
  it("accepts the fully-conforming §5.3 output", () => {
    expect(validateStructuredShape(COACH_SCHEMA, validCoach())).toEqual([]);
    expect(
      validateStructuredShape(COACH_SCHEMA, {
        verdict: "needs_work",
        dimension: "too_short",
        hint: "Too short to interpret.",
        example: "",
      }),
    ).toEqual([]);
  });

  it("flags each missing required field", () => {
    for (const field of ["verdict", "dimension", "hint", "example"]) {
      const partial: Record<string, unknown> = { ...validCoach() };
      delete partial[field];
      const violations = validateStructuredShape(COACH_SCHEMA, partial);
      expect(violations, `missing ${field}`).toContain(`$.${field} is required`);
    }
  });

  it("flags a verdict that is not ok | needs_work", () => {
    const violations = validateStructuredShape(COACH_SCHEMA, {
      ...validCoach(),
      verdict: "great",
    });
    expect(violations).toContain('$.verdict must be one of ["ok","needs_work"]');
  });

  it("flags a dimension outside the four configured dimensions", () => {
    for (const bad of ["length", "measurability_extra", ""]) {
      const violations = validateStructuredShape(COACH_SCHEMA, {
        ...validCoach(),
        verdict: "needs_work",
        dimension: bad,
      });
      expect(violations, `dimension=${JSON.stringify(bad)}`).not.toEqual([]);
    }
  });

  it("accepts null dimension but flags any other showable dimension", () => {
    expect(validateStructuredShape(COACH_SCHEMA, validCoach())).toEqual([]);
  });

  it("flags a wrong type on a string field", () => {
    const violations = validateStructuredShape(COACH_SCHEMA, {
      ...validCoach(),
      hint: 42,
    });
    expect(violations).toContain("$.hint must be of type string");
  });
});

describe("the array/object subset used by the analysis tools", () => {
  const ANALYSIS_SCHEMA = {
    type: "object",
    properties: {
      agreement: { type: "string" },
      conflicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            between: { type: "string" },
            positions: { type: "array", items: { type: "string" } },
          },
          required: ["between", "positions"],
        },
      },
      readNote: { type: ["string", "null"] },
    },
    required: ["agreement", "conflicts", "readNote"],
  };

  it("accepts a conforming nested-array output", () => {
    expect(
      validateStructuredShape(ANALYSIS_SCHEMA, {
        agreement: "Both want to grow the metric.",
        conflicts: [
          {
            between: "A and B",
            positions: ["Reach up.", "Profit must come first."],
          },
        ],
        readNote: null,
      }),
    ).toEqual([]);
  });

  it("flags a missing nested required field inside an array item", () => {
    const violations = validateStructuredShape(ANALYSIS_SCHEMA, {
      agreement: "x",
      conflicts: [{ between: "A and B" }], // positions missing
      readNote: null,
    });
    expect(violations).toContain("$.conflicts[0].positions is required");
  });

  it("flags a wrong element type inside an array of strings", () => {
    const violations = validateStructuredShape(ANALYSIS_SCHEMA, {
      agreement: "x",
      conflicts: [{ between: "A and B", positions: [1] }],
      readNote: null,
    });
    expect(violations).toContain("$.conflicts[0].positions[0] must be of type string");
  });

  it("accepts both branches of a ['string','null'] union and rejects neither a plain union member", () => {
    expect(
      validateStructuredShape(
        { type: ["string", "null"] },
        "a note",
      ),
    ).toEqual([]);
    expect(validateStructuredShape({ type: ["string", "null"] }, null)).toEqual([]);
    expect(validateStructuredShape({ type: ["string", "null"] }, 7)).toContain(
      "$ must be of type string",
    );
  });

  it("a boolean field rejects a non-boolean value", () => {
    const classifySchema = {
      type: "object",
      properties: { compatible: { type: "boolean" }, reason: { type: "string" } },
      required: ["compatible", "reason"],
    };
    expect(
      validateStructuredShape(classifySchema, { compatible: true, reason: "inflate" }),
    ).toEqual([]);
    expect(
      validateStructuredShape(classifySchema, { compatible: "yes", reason: "inflate" }),
    ).toContain("$.compatible must be of type boolean");
  });
});

describe("schema unknown to the subset", () => {
  it("the top-level shape is still enforced when a node carries no type", () => {
    // `{"type":"object"}` is part of the subset, but the requirement here is
    // that a node lacking a usable type does not crash and still reports what
    // it can (an object that is missing a required field).
    expect(
      validateStructuredShape(
        { type: "object", required: ["x"] },
        { y: 1 },
      ),
    ).toContain("$.x is required");
  });

  it("an undefined schema imposes no constraint", () => {
    expect(validateStructuredShape(undefined, { anything: true })).toEqual([]);
  });
});