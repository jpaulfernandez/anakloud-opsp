import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";
import {
  CIRCUIT_OPEN_BASE_MS,
  CIRCUIT_FAILURE_THRESHOLD,
  circuitOpenAt,
  closedCircuit,
  loadCircuit,
  recordFailure,
  resetCircuitMemory,
  saveCircuit,
} from "../../lib/circuit";

// F12-T03 — circuit persistence against a real Postgres. Runs only when opted
// in (`DATABASE_URL` set AND `RUN_DB_TESTS=1`), SKIPS otherwise, inside a
// temporary schema it drops afterwards — the same pattern as the other DB
// tests.
//
// Proves the "circuit state survives a restart" acceptance. Durable circuit
// state lives in `ai_budget`'s §3 columns; a process restart only clears the
// in-memory live copy, so re-reading from the database after
// `resetCircuitMemory()` — which is what a cold start does — must recover the
// open flag, the plain-language reason and the absolute open-window deadline.
// A cohort that has never opened simply reads a closed circuit, and saving to
// a cohort with no budget row surfaces loudly rather than silently losing the
// write (the budget row is created at cohort creation, F12-T04).

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

const COHORT = "dddd1111-dddd-1111-dddd-111111110301";
const NO_BUDGET_COHORT = "dddd1111-dddd-1111-dddd-111111110302";

const NOW = 1_700_000_000_000;

let db = null as ReturnType<typeof createDbClient> | null;
let schemaName = "";

describe.skipIf(!enabled)("circuit persistence against a real Postgres", () => {
  beforeAll(async () => {
    db = createDbClient();
    await db.connect();
    schemaName = `circuit_test_${Date.now()}`;
    await db.query(`create schema ${schemaName}`);
    await db.query(`set search_path = ${schemaName}, public`);
    await migrate(db!);

    await db!.query(
      `insert into cohorts (id, name, quarter_label, status)
       values ($1, 'Test', 'Q4 2026', 'open')`,
      [COHORT],
    );
    await db!.query(
      `insert into ai_budget (cohort_id, input_cap, output_cap)
       values ($1, 1000000, 500000)`,
      [COHORT],
    );
  });

  afterAll(async () => {
    try {
      if (schemaName) await db?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await db?.end();
    }
  });

  it("recovers an open circuit from the database after a restart", async () => {
    // Open the circuit in this process and persist the durable subset.
    let state = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) {
      state = recordFailure(state, NOW + i);
    }
    await saveCircuit(db!, COHORT, state);

    // A cold start drops the in-memory live copy but keeps the database.
    resetCircuitMemory();
    const reloaded = await loadCircuit(db!, COHORT);

    expect(reloaded.open).toBe(true);
    expect(reloaded.reason).toBe("three consecutive provider failures");
    expect(reloaded.untilMs).toBe(NOW + CIRCUIT_FAILURE_THRESHOLD + CIRCUIT_OPEN_BASE_MS);
    // The recovered state still refuses model calls and therefore still serves L2.
    expect(circuitOpenAt(reloaded, NOW + CIRCUIT_FAILURE_THRESHOLD)).toBe(true);
  });

  it("persisted state round-trips the open-window deadline exactly", async () => {
    resetCircuitMemory();
    const reloaded = await loadCircuit(db!, COHORT);
    expect(reloaded.open).toBe(true);
    expect(reloaded.untilMs).toBe(NOW + CIRCUIT_FAILURE_THRESHOLD + CIRCUIT_OPEN_BASE_MS);
  });

  it("a cohort with no budget row reads a closed circuit", async () => {
    resetCircuitMemory();
    const state = await loadCircuit(db!, NO_BUDGET_COHORT);
    expect(state.open).toBe(false);
    expect(state.reason).toBeNull();
    expect(state.untilMs).toBeNull();
  });

  it("fails loudly rather than silently dropping a save to a cohort without a budget row", async () => {
    let opened = closedCircuit();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i++) opened = recordFailure(opened, NOW + i);
    await expect(saveCircuit(db!, NO_BUDGET_COHORT, opened)).rejects.toThrow("no ai_budget row");
  });
});