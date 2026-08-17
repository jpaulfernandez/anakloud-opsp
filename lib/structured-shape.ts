// Structured-output shape conformance (F18-T02, source item M07).
//
// Gemini's tool-use mode forces the model to fill a function declaration, but
// a forced call is not a guarantee that the *arguments* satisfy the declared
// schema — a silently-ignored keyword, or a non-conforming args object, both
// arrive as a successful 200 with no structural guarantee left. This module is
// the check that runs at the boundary before the provider serialises the args
// for the output guard: it walks the declared `input_schema` and reports
// whether the returned arguments conform, so a partial or off-shape result is
// treated as a provider failure rather than passed on.
//
// It understands exactly the OpenAPI-3.0-subset dialect the product's
// structured tools declare (coach, analysis, OPSP analysis, classification,
// synthesis) — object/string/boolean/array, nested `properties` + `required`,
// `items`, string `enum`, and null spelled as `nullable: true` or a `type`
// union that includes "null". Pure, no I/O, no network, no vendor import —
// consistent with the F13 pure-function rule and independently testable.

/** A violation of the declared shape; one string per failed constraint. */
export type ShapeViolation = string;

/** The Node type a structured tool may declare, in the subset we support. */
type SchemaNode = {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  nullable?: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNode(schema: unknown): SchemaNode | null {
  return isRecord(schema) ? schema : null;
}

/** A `type` declaration normalised to a base-type list, null union peeled off. */
function declaredTypes(s: SchemaNode): string[] {
  const t = s.type;
  if (t === undefined) return [];
  return (Array.isArray(t) ? t : [t]).filter((x) => x !== "null");
}

/** Whether the node permits a null value, in either dialect. */
function nullAllowed(s: SchemaNode): boolean {
  if (s.nullable === true) return true;
  const t = s.type;
  return Array.isArray(t) && t.includes("null");
}

function matchesBase(value: unknown, base: string): boolean {
  switch (base) {
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "array":
      return Array.isArray(value);
    case "object":
      return isRecord(value);
    default:
      return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Walk one node of the declared schema against a value and return every
 * constraint it violates. An empty result means the value conforms. Nodes with
 * no usable `type` (or unsupported keywords) impose no constraint, so a schema
 * dialect we do not understand degrades to "pass rather than guess" — the
 * (enum/required/null) constraints that matter are still enforced.
 */
export function validateStructuredShape(
  schema: unknown,
  value: unknown,
  path = "$",
): ShapeViolation[] {
  const s = asNode(schema);
  if (s === null) return [];

  if (value === null) {
    return nullAllowed(s) ? [] : [`${path} must not be null`];
  }

  const bases = declaredTypes(s);
  if (bases.length > 0 && !bases.some((b) => matchesBase(value, b))) {
    return [`${path} must be of type ${bases.join(" or ")}`];
  }

  if (Array.isArray(s.enum) && s.enum.length > 0 && !s.enum.includes(value)) {
    return [`${path} must be one of ${JSON.stringify(s.enum)}`];
  }

  if (bases.includes("object")) {
    if (!isObject(value)) return [`${path} must be an object`];
    const violations: ShapeViolation[] = [];
    for (const required of s.required ?? []) {
      if (!(required in value)) violations.push(`${path}.${required} is required`);
    }
    for (const [key, sub] of Object.entries(s.properties ?? {})) {
      if (key in value) {
        violations.push(...validateStructuredShape(sub, value[key], `${path}.${key}`));
      }
    }
    return violations;
  }

  if (bases.includes("array")) {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    const violations: ShapeViolation[] = [];
    value.forEach((element, i) => {
      violations.push(...validateStructuredShape(s.items, element, `${path}[${i}]`));
    });
    return violations;
  }

  return [];
}