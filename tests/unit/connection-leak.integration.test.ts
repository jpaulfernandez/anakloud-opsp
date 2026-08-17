import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbClient } from "../../lib/db";
import { migrate } from "../../lib/migrate";

// F17-T03 (M03) leak guard against a real Postgres. Like every other DB test
// it runs only when the operator opts in (`DATABASE_URL` set AND
// `RUN_DB_TESTS=1`), SKIPS otherwise, and works inside a temporary schema it
// drops afterwards. `./verify.sh` never sets `RUN_DB_TESTS`, so this stays out
// of the default run — it needs a database reachable by the Neon serverless
// driver, which the local docker Postgres is not.
//
// The two acceptance criteria that need live connections:
//
//   * Injected failures between connect and completion release the connection
//     — drive the exact request pattern (createDbClient → connect → try {
//     ... } finally { end() }) with the body throwing after connect, and show
//     the active-connection count returns to baseline instead of climbing.
//   * Two hundred sequential requests produce no upward trend in active
//     connections — run 200 of those cycles back to back and show the count
//     stays flat.
//
// Connections are counted from the database's own view (`pg_stat_activity`):
// a client that is ended no longer holds a backend, so a process that leaks
// one per request would push the count up by one each cycle. This is the same
// signal Neon plans expose as "active connections".

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.RUN_DB_TESTS === "1";

// How many cycles constitute the "repeated requests" acceptance.
const REQUEST_COUNT = 200;
// Inject a failure on roughly this fraction of cycles.
const FAILURE_STEP = 7;

describe.skipIf(!enabled)("connection release under repeated requests (F17-T03)", () => {
  let probe = null as ReturnType<typeof createDbClient> | null;
  let schemaName = "";

  beforeAll(async () => {
    probe = createDbClient();
    await probe.connect();
    schemaName = `leak_test_${Date.now()}`;
    await probe.query(`create schema ${schemaName}`);
    await probe.query(`set search_path = ${schemaName}, public`);
    await migrate(probe!);
  });

  afterAll(async () => {
    try {
      if (schemaName) await probe?.query(`drop schema if exists ${schemaName} cascade`);
    } finally {
      await probe?.end();
    }
  });

  const currentConnections = async (): Promise<number> => {
    const { rows } = await probe!.query(
      "select count(*)::int as n from pg_stat_activity where datname = current_database()",
    );
    return rows[0].n as number;
  };

  /** One request-shaped lifecycle: connect, do work, release in finally. */
  const runRequest = async (fail: boolean): Promise<void> => {
    const db = createDbClient();
    await db.connect();
    try {
      await db.query("select 1");
      if (fail) {
        // A simulated request failure after connecting: an invalid statement,
        // as close to a real error mid-request as the deterministic path gets.
        throw new Error("injected failure after connect");
      }
    } finally {
      await db.end();
    }
  };

  it("releases the connection when the request body throws after connecting", async () => {
    // Baseline captures the probe backend plus anything already open.
    const baseline = await currentConnections();

    // Run a burst of failing requests, each ending in a finally. If a call
    // site skipped the finally, every failure would leave a leaked backend and
    // the count would climb by one per cycle.
    for (let i = 0; i < 20; i += 1) {
      await expect(runRequest(true)).rejects.toThrow(/injected failure/);
    }

    // Allow the driver a tick to tear down the closed connections before we
    // look again, so we are comparing steady state, not a close in flight.
    await new Promise((r) => setTimeout(r, 50));
    const after = await currentConnections();

    expect(after).toBeLessThanOrEqual(baseline + 1);
  });

  it("two hundred sequential requests produce no upward trend in active connections", async () => {
    const baseline = await currentConnections();

    // 200 sequential request/response cycles over full connect→end lifecycles,
    // with periodic injected failures, sampled every 40 cycles. None of the
    // samples may trend above baseline: a live leak grows the count linearly.
    const samples: number[] = [];
    for (let i = 0; i < REQUEST_COUNT; i += 1) {
      const fail = i % FAILURE_STEP === 0;
      try {
        await runRequest(fail);
      } catch {
        // expected for the injected-failure cycles
      }
      if ((i + 1) % 40 === 0) samples.push(await currentConnections());
    }

    // Allow any in-flight teardown to settle before the final measurement.
    await new Promise((r) => setTimeout(r, 50));
    const finalCount = await currentConnections();

    const worst = Math.max(...samples, finalCount);
    expect(worst, "active connections must not trend upward over 200 requests").toBeLessThanOrEqual(
      baseline + 1,
    );
  });
});