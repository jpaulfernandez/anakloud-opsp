import { describe, expect, it } from "vitest";
import {
  foreignKeyColumns,
  renderDownSql,
  renderUpSql,
  SCHEMA,
} from "../../lib/schema";
import { MIGRATIONS } from "../../lib/migrate";

// The expected shape, hand-written from tech_infrastructure.md §3 and
// independent of SCHEMA, so this test is a real check that the schema
// definition matches the spec rather than a mirror of itself.
const EXPECTED: Record<
  string,
  Record<string, { type: string; nullable: boolean }>
> = {
  cohorts: {
    id: { type: "uuid", nullable: false },
    name: { type: "text", nullable: false },
    quarter_label: { type: "text", nullable: false },
    opens_at: { type: "timestamptz", nullable: true },
    closes_at: { type: "timestamptz", nullable: true },
    status: { type: "text", nullable: false },
    ai_level_pin: { type: "text", nullable: true },
    created_at: { type: "timestamptz", nullable: false },
  },
  respondents: {
    id: { type: "uuid", nullable: false },
    cohort_id: { type: "uuid", nullable: false },
    display_name: { type: "text", nullable: false },
    email: { type: "text", nullable: true },
    invite_token: { type: "text", nullable: false },
    resume_code: { type: "text", nullable: false },
    is_facilitator: { type: "bool", nullable: false },
    started_at: { type: "timestamptz", nullable: true },
    submitted_at: { type: "timestamptz", nullable: true },
    unlocked_by: { type: "uuid", nullable: true },
    unlocked_at: { type: "timestamptz", nullable: true },
  },
  answers: {
    id: { type: "uuid", nullable: false },
    respondent_id: { type: "uuid", nullable: false },
    question_id: { type: "text", nullable: false },
    value: { type: "jsonb", nullable: false },
    confidence: { type: "smallint", nullable: true },
    is_private: { type: "bool", nullable: false },
    updated_at: { type: "timestamptz", nullable: false },
  },
  answer_snapshots: {
    id: { type: "uuid", nullable: false },
    respondent_id: { type: "uuid", nullable: false },
    payload: { type: "jsonb", nullable: false },
    taken_at: { type: "timestamptz", nullable: false },
  },
  opsp_drafts: {
    id: { type: "uuid", nullable: false },
    cohort_id: { type: "uuid", nullable: false },
    owner_type: { type: "text", nullable: false },
    owner_id: { type: "uuid", nullable: true },
    version: { type: "int", nullable: false },
    cells: { type: "jsonb", nullable: false },
    label: { type: "text", nullable: true },
    created_at: { type: "timestamptz", nullable: false },
  },
  ai_interactions: {
    id: { type: "uuid", nullable: false },
    respondent_id: { type: "uuid", nullable: true },
    question_id: { type: "text", nullable: true },
    purpose: { type: "text", nullable: false },
    attempt_no: { type: "smallint", nullable: true },
    level: { type: "text", nullable: false },
    model: { type: "text", nullable: true },
    verdict: { type: "text", nullable: true },
    hint_text: { type: "text", nullable: true },
    example_shown: { type: "bool", nullable: false },
    answer_changed: { type: "bool", nullable: true },
    input_tokens: { type: "int", nullable: false },
    output_tokens: { type: "int", nullable: false },
    guard_tripped: { type: "text", nullable: true },
    created_at: { type: "timestamptz", nullable: false },
  },
  ai_budget: {
    cohort_id: { type: "uuid", nullable: false },
    input_cap: { type: "int", nullable: false },
    output_cap: { type: "int", nullable: false },
    input_used: { type: "int", nullable: false },
    output_used: { type: "int", nullable: false },
    circuit_open: { type: "bool", nullable: false },
    circuit_reason: { type: "text", nullable: true },
    circuit_until: { type: "timestamptz", nullable: true },
  },
};

function hasUnique(table: string, columns: string[]): boolean {
  const uniques = SCHEMA[table].uniques ?? [];
  return uniques.some((u) => u.length === columns.length && columns.every((c) => u.includes(c)));
}

describe("core schema (tech_infrastructure.md §3)", () => {
  it("defines exactly the seven tables", () => {
    expect(Object.keys(SCHEMA).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))(
    "table %s has every column with the stated type and nullability",
    (table, columns) => {
      for (const [name, expected] of Object.entries(columns)) {
        const def = SCHEMA[table].columns[name];
        expect(def, `${table}.${name} column missing`).toBeDefined();
        expect(def.type, `${table}.${name} type`).toBe(expected.type);
        expect(!!def.nullable, `${table}.${name} nullability`).toBe(expected.nullable);
      }
    },
  );

  it("has no columns in the schema that the spec does not name", () => {
    for (const [table, columns] of Object.entries(SCHEMA)) {
      for (const name of Object.keys(columns.columns)) {
        expect(EXPECTED[table][name], `${table}.${name} is not in §3`).toBeDefined();
      }
    }
  });

  it("enforces unique (respondent_id, question_id) on answers", () => {
    expect(hasUnique("answers", ["respondent_id", "question_id"])).toBe(true);
  });

  it("enforces uniqueness on respondents.invite_token", () => {
    expect(hasUnique("respondents", ["invite_token"])).toBe(true);
  });

  it("stores answer payloads as jsonb", () => {
    expect(SCHEMA.answers.columns.value.type).toBe("jsonb");
    expect(SCHEMA.answer_snapshots.columns.payload.type).toBe("jsonb");
    expect(SCHEMA.opsp_drafts.columns.cells.type).toBe("jsonb");
  });

  it("makes a respondent row's cohort reachable by join without a full scan", () => {
    // answers -> respondents -> cohorts, each hop indexed.
    expect(SCHEMA.answers.columns.respondent_id.references?.table).toBe("respondents");
    expect(SCHEMA.respondents.columns.cohort_id.references?.table).toBe("cohorts");

    const up = renderUpSql(SCHEMA);
    expect(up).toContain("create index answers_respondent_id_idx on answers (respondent_id);");
    expect(up).toContain("create index respondents_cohort_id_idx on respondents (cohort_id);");
  });

  it("creates an index on every foreign key column", () => {
    const up = renderUpSql(SCHEMA);
    for (const [table, tableDef] of Object.entries(SCHEMA)) {
      for (const column of foreignKeyColumns(tableDef)) {
        expect(up).toContain(
          `create index ${table}_${column}_idx on ${table} (${column});`,
        );
      }
    }
  });
});

describe("migrations", () => {
  it("ships a reversible down migration for every migration", () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    for (const migration of MIGRATIONS) {
      expect(migration.up.trim().length).toBeGreaterThan(0);
      expect(migration.down.trim().length).toBeGreaterThan(0);
    }
  });

  it("down migration drops each table", () => {
    const down = renderDownSql(SCHEMA);
    for (const table of Object.keys(EXPECTED)) {
      expect(down).toContain(`drop table if exists ${table};`);
    }
  });

  it("down migration reverses up in dependency order", () => {
    const down = renderDownSql(SCHEMA);
    const upIndex = (t: string) => renderUpSql(SCHEMA).indexOf(`create table ${t} `);
    const downIndex = (t: string) => down.indexOf(`drop table if exists ${t};`);

    // ai_budget (a child) must be dropped before cohorts (its parent).
    expect(downIndex("ai_budget")).toBeLessThan(downIndex("cohorts"));
    expect(upIndex("ai_budget")).toBeGreaterThan(upIndex("cohorts"));
  });
});