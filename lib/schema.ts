// The database schema — single source of truth (F01-T02).
//
// Every table, column, constraint and index in here mirrors the data model in
// tech_infrastructure.md §3. The up/down migration SQL is generated from this
// definition rather than written by hand so the schema under test and the SQL
// applied to Postgres can never drift apart.
//
// Nullability follows §3 exactly: a column is `nullable` only where the spec
// marks it null (optional email, ai_level_pin, audit timestamps) or where a
// row legitimately has no value yet (opens_at/closes_at, owner_id, verdicts).
// Everything else is NOT NULL — these are fields a row always carries.

export type SqlType =
  | "uuid"
  | "text"
  | "jsonb"
  | "timestamptz"
  | "smallint"
  | "int"
  | "bool";

export interface ColumnDef {
  type: SqlType;
  nullable?: boolean;
  /** Raw SQL default, e.g. "now()" or "false". */
  default?: string;
  /** Foreign key target. Renders `fk` and an index on the column. */
  references?: { table: string; column: string };
}

export interface TableDef {
  columns: Record<string, ColumnDef>;
  primaryKey: string[];
  /** Composite unique constraints, as lists of column names. */
  uniques?: string[][];
  /** Extra multi-column indexes beyond the per-FK ones. */
  indexes?: string[][];
}

export type SchemaDef = Record<string, TableDef>;

function col(name: string, type: SqlType, def: Partial<ColumnDef> = {}): ColumnDef {
  return { type, ...def };
}

export const SCHEMA: SchemaDef = {
  cohorts: {
    columns: {
      id: col("id", "uuid"),
      name: col("name", "text"),
      quarter_label: col("quarter_label", "text"),
      opens_at: col("opens_at", "timestamptz", { nullable: true }),
      closes_at: col("closes_at", "timestamptz", { nullable: true }),
      status: col("status", "text", { default: "'draft'" }),
      ai_level_pin: col("ai_level_pin", "text", { nullable: true }),
      created_at: col("created_at", "timestamptz", { default: "now()" }),
    },
    primaryKey: ["id"],
  },

  respondents: {
    columns: {
      id: col("id", "uuid"),
      cohort_id: col("cohort_id", "uuid", { references: { table: "cohorts", column: "id" } }),
      display_name: col("display_name", "text"),
      email: col("email", "text", { nullable: true }),
      invite_token: col("invite_token", "text"),
      invite_revoked_at: col("invite_revoked_at", "timestamptz", { nullable: true }),
      resume_code: col("resume_code", "text"),
      ground_rules_acknowledged_at: col("ground_rules_acknowledged_at", "timestamptz", {
        nullable: true,
      }),
      is_facilitator: col("is_facilitator", "bool", { default: "false" }),
      started_at: col("started_at", "timestamptz", { nullable: true }),
      submitted_at: col("submitted_at", "timestamptz", { nullable: true }),
      unlocked_by: col("unlocked_by", "uuid", { nullable: true }),
      unlocked_at: col("unlocked_at", "timestamptz", { nullable: true }),
    },
    primaryKey: ["id"],
    uniques: [["invite_token"]],
  },

  answers: {
    columns: {
      id: col("id", "uuid"),
      respondent_id: col("respondent_id", "uuid", {
        references: { table: "respondents", column: "id" },
      }),
      question_id: col("question_id", "text"),
      value: col("value", "jsonb"),
      confidence: col("confidence", "smallint", { nullable: true }),
      is_private: col("is_private", "bool", { default: "false" }),
      updated_at: col("updated_at", "timestamptz", { default: "now()" }),
    },
    primaryKey: ["id"],
    uniques: [["respondent_id", "question_id"]],
  },

  answer_snapshots: {
    columns: {
      id: col("id", "uuid"),
      respondent_id: col("respondent_id", "uuid", {
        references: { table: "respondents", column: "id" },
      }),
      payload: col("payload", "jsonb"),
      taken_at: col("taken_at", "timestamptz", { default: "now()" }),
    },
    primaryKey: ["id"],
  },

  opsp_drafts: {
    columns: {
      id: col("id", "uuid"),
      cohort_id: col("cohort_id", "uuid", { references: { table: "cohorts", column: "id" } }),
      owner_type: col("owner_type", "text"),
      owner_id: col("owner_id", "uuid", {
        nullable: true,
        references: { table: "respondents", column: "id" },
      }),
      version: col("version", "int"),
      cells: col("cells", "jsonb"),
      label: col("label", "text", { nullable: true }),
      created_at: col("created_at", "timestamptz", { default: "now()" }),
    },
    primaryKey: ["id"],
    indexes: [["cohort_id", "owner_type"]],
  },

  ai_interactions: {
    columns: {
      id: col("id", "uuid"),
      respondent_id: col("respondent_id", "uuid", {
        nullable: true,
        references: { table: "respondents", column: "id" },
      }),
      question_id: col("question_id", "text", { nullable: true }),
      purpose: col("purpose", "text"),
      attempt_no: col("attempt_no", "smallint", { nullable: true }),
      level: col("level", "text"),
      model: col("model", "text", { nullable: true }),
      verdict: col("verdict", "text", { nullable: true }),
      hint_text: col("hint_text", "text", { nullable: true }),
      example_shown: col("example_shown", "bool", { default: "false" }),
      answer_changed: col("answer_changed", "bool", { nullable: true }),
      input_tokens: col("input_tokens", "int", { default: "0" }),
      output_tokens: col("output_tokens", "int", { default: "0" }),
      guard_tripped: col("guard_tripped", "text", { nullable: true }),
      created_at: col("created_at", "timestamptz", { default: "now()" }),
    },
    primaryKey: ["id"],
  },

  ai_budget: {
    columns: {
      cohort_id: col("cohort_id", "uuid", {
        references: { table: "cohorts", column: "id" },
      }),
      input_cap: col("input_cap", "int"),
      output_cap: col("output_cap", "int"),
      input_used: col("input_used", "int", { default: "0" }),
      output_used: col("output_used", "int", { default: "0" }),
      circuit_open: col("circuit_open", "bool", { default: "false" }),
      circuit_reason: col("circuit_reason", "text", { nullable: true }),
      circuit_until: col("circuit_until", "timestamptz", { nullable: true }),
    },
    primaryKey: ["cohort_id"],
  },
};

/** "cohort reachable by join" is guaranteed by an index on every FK column. */
export function foreignKeyColumns(tableDef: TableDef): string[] {
  return Object.entries(tableDef.columns)
    .filter(([, def]) => def.references !== undefined)
    .map(([name]) => name);
}

function columnDdl(name: string, def: ColumnDef): string {
  const bits = [name, def.type];
  bits.push(def.nullable ? "null" : "not null");
  if (def.default !== undefined) bits.push(`default ${def.default}`);
  return bits.join(" ").trim();
}

function indexName(table: string, columns: string[]): string {
  return `${table}_${columns.join("_")}_idx`;
}

/**
 * Render `create table` + index statements for the whole schema. Children come
 * after parents so FKs reference existing tables; ai_budget is last because
 * its primary key is itself a foreign key.
 */
export function renderUpSql(schema: SchemaDef): string {
  const order = [
    "cohorts",
    "respondents",
    "answers",
    "answer_snapshots",
    "opsp_drafts",
    "ai_interactions",
    "ai_budget",
  ];

  const creates: string[] = [];
  const indexes: string[] = [];

  for (const table of order) {
    const def = schema[table];
    const lines: string[] = [];
    for (const [name, column] of Object.entries(def.columns)) {
      lines.push(`  ${columnDdl(name, column)}`);
    }
    lines.push(`  primary key (${def.primaryKey.join(", ")})`);
    if (def.uniques) {
      for (const u of def.uniques) {
        lines.push(`  unique (${u.join(", ")})`);
      }
    }
    for (const [name, column] of Object.entries(def.columns)) {
      if (column.references) {
        lines.push(
          `  foreign key (${name}) references ${column.references.table} (${column.references.column})`,
        );
      }
    }
    creates.push(`create table ${table} (\n${lines.join(",\n")}\n);`);

    for (const fkColumn of foreignKeyColumns(def)) {
      indexes.push(`create index ${indexName(table, [fkColumn])} on ${table} (${fkColumn});`);
    }
    for (const idx of def.indexes ?? []) {
      indexes.push(`create index ${indexName(table, idx)} on ${table} (${idx.join(", ")});`);
    }
  }

  return `${creates.join("\n\n")}\n\n${indexes.join("\n")}\n`;
}

/** Render `drop table` statements in reverse dependency order. */
const DROP_ORDER = [
  "ai_budget",
  "ai_interactions",
  "opsp_drafts",
  "answer_snapshots",
  "answers",
  "respondents",
  "cohorts",
];

export function renderDownSql(schema: SchemaDef): string {
  const tables = DROP_ORDER.filter((t) => t in schema);
  return tables.map((t) => `drop table if exists ${t};`).join("\n") + "\n";
}