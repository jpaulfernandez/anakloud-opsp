import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F09-T04 end to end: the level & budget header strip on the admin dashboard,
// against a real Postgres on the same opt-in as the other DB-gated e2e specs
// (SKIP unless DATABASE_URL and SESSION_SECRET are present). Covers the
// ticket's rendered acceptances:
//
//   1. At P1 the strip renders showing L2 with an honest reason — the served
//      level is the deterministic pin (L2 under the local/preview default),
//      and a cohort with no budget row shows an honest rule-based statement,
//      never a fabricated spend figure.
//   2. The strip surfaces budget used against cap and warns at 70% then 90%.
//   3. It also reports circuit state and the count of guard trips.
//   4. No respondent-facing view references the level, budget or circuit
//      strip — it renders only on the admin dashboard.
//
// The pure derivations (level reasons, budget percentages, threshold warnings)
// are asserted exhaustively in tests/unit/level-strip.test.ts.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Level Strip', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
     values ($1, $2, 'Lia Mendoza', $3, 'LSL1', true, now())`,
    [FACILITATOR, COHORT, `level-strip-fac-${run}`],
  );
  // An unsubmitted, ground-rules-acknowledged respondent, so a real question
  // page is reachable for the "not surfaced to respondents" check.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Tory Kind', $3, 'LSL2', false, now())`,
    [RESPONDENT, COHORT, `level-strip-res-${run}`],
  );
});

test.afterAll(async () => {
  if (db) {
    // Dependents first, so the cohort and respondents are removable (the budget
    // row keys on the cohort; guard-trip rows reference respondents).
    await db
      .query("delete from ai_budget where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db
      .query(
        `delete from ai_interactions
          where respondent_id in (select id from respondents where cohort_id = $1)`,
        [COHORT],
      )
      .catch(() => {});
    await db
      .query("delete from respondents where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

/** Insert or overwrite the cohort's ai_budget row, keeping test order shapeless. */
async function upsertBudget(row: {
  inputCap?: number;
  inputUsed?: number;
  outputCap?: number;
  outputUsed?: number;
  circuitOpen?: boolean;
  circuitReason?: string | null;
}) {
  await db!.query(
    `insert into ai_budget
       (cohort_id, input_cap, input_used, output_cap, output_used,
        circuit_open, circuit_reason)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (cohort_id) do update set
       input_cap = excluded.input_cap,
       input_used = excluded.input_used,
       output_cap = excluded.output_cap,
       output_used = excluded.output_used,
       circuit_open = excluded.circuit_open,
       circuit_reason = excluded.circuit_reason`,
    [
      COHORT,
      Math.round(row.inputCap ?? 100),
      Math.round(row.inputUsed ?? 0),
      Math.round(row.outputCap ?? 100),
      Math.round(row.outputUsed ?? 0),
      row.circuitOpen ?? false,
      row.circuitReason ?? null,
    ],
  );
}

async function setSession(page: Page, respondentId: string) {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  await page.context().addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
  ]);
}

test("the admin strip renders showing L2 with an honest rule-based reason", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);
  await page.goto("/admin");

  const strip = page.getByTestId("admin-level-strip");
  await expect(strip).toBeVisible();

  // The deterministic pin reads L2 under the default local/preview level.
  await expect(strip.getByTestId("strip-level")).toHaveText("L2");
  await expect(strip.getByTestId("strip-reason")).toHaveText(
    "Running on rule-based checks.",
  );

  // No budget row exists yet, so spend / circuit are honest dashes (P1) and
  // there is nothing to warn about.
  await expect(strip.getByTestId("strip-budget")).toHaveText("—");
  await expect(strip.getByTestId("strip-circuit")).toHaveText("—");
  await expect(strip.getByTestId("strip-guard-trips")).toHaveText("0");
  await expect(strip.getByTestId("strip-warning")).toHaveCount(0);
  // With no trips there is nothing to raise a contamination alert about.
  await expect(strip.getByTestId("strip-guard-alert")).toHaveCount(0);
});

test("the strip surfaces budget used against cap and warns at 70% then 90%", async ({
  page,
}) => {
  await setSession(page, FACILITATOR);

  // 75% of the combined cap → the 70% warning.
  await upsertBudget({ inputUsed: 75, outputUsed: 75 });
  await page.goto("/admin");
  const strip = page.getByTestId("admin-level-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId("strip-budget")).toHaveText("150 / 200");
  await expect(strip.getByTestId("strip-warning")).toHaveText(
    "AI budget above 70% — watch usage.",
  );

  // 95% → the 90% warning, and the L2 reason now echoes the share (§7.2).
  await upsertBudget({ inputUsed: 95, outputUsed: 95 });
  await page.reload();
  await expect(strip.getByTestId("strip-warning")).toHaveText(
    "AI budget above 90% — nearly exhausted.",
  );
  await expect(strip.getByTestId("strip-reason")).toHaveText(
    "Running on rule-based checks — AI budget at 95%.",
  );

  // A further reload at the same spend must not re-fire either warning: the
  // thresholds already fired and their flags were persisted (F12-T07).
  await page.reload();
  await expect(strip.getByTestId("strip-warning")).toHaveCount(0);
});

test("the strip reports circuit state and the count of guard trips", async ({
  page,
}) => {
  await upsertBudget({ circuitOpen: true, circuitReason: "budget exhausted" });
  await db!.query(
    `insert into ai_interactions
       (id, respondent_id, purpose, level, guard_tripped)
     values ($1, $2, 'coach', 'L0', 'content')`,
    [randomUUID(), RESPONDENT],
  );

  await setSession(page, FACILITATOR);
  await page.goto("/admin");
  const strip = page.getByTestId("admin-level-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId("strip-circuit")).toHaveText("Open");
  await expect(strip.getByTestId("strip-guard-trips")).toHaveText("1");
  // One trip is below the §11 alert threshold.
  await expect(strip.getByTestId("strip-guard-alert")).toHaveCount(0);
});

test("the strip alerts the facilitator at three or more guard trips", async ({
  page,
}) => {
  // Push the cohort's guard-trip count to at least 3 (some tests above may
  // already have added one), then expect the standing contamination alert.
  await db!.query(
    `insert into ai_interactions
       (id, respondent_id, purpose, level, guard_tripped)
     values ($1, $2, 'coach', 'L0', 'form'),
            ($3, $2, 'coach', 'L0', 'form'),
            ($4, $2, 'coach', 'L0', 'form')`,
    [randomUUID(), RESPONDENT, randomUUID(), randomUUID()],
  );

  await setSession(page, FACILITATOR);
  await page.goto("/admin");
  const strip = page.getByTestId("admin-level-strip");
  await expect(strip).toBeVisible();

  const trips = Number(await strip.getByTestId("strip-guard-trips").innerText());
  expect(trips).toBeGreaterThanOrEqual(3);
  await expect(strip.getByTestId("strip-guard-alert")).toBeVisible();
  await expect(strip.getByTestId("strip-guard-alert")).toContainText(
    "3 or more",
  );
});

test("no respondent-facing view references the level, budget or circuit strip", async ({
  page,
}) => {
  await setSession(page, RESPONDENT);
  await page.goto("/q/7");

  // The strip itself never renders outside the admin dashboard…
  await expect(page.getByTestId("admin-level-strip")).toHaveCount(0);

  // …and its copy (level badge, reason, budget/circuit/guard terms) is absent
  // from the respondent-facing DOM (PR6 — the facilitator alone sees any of it).
  const body = (await page.locator("body").innerText()).toLowerCase();
  expect(body).not.toContain("running on rule-based checks");
  expect(body).not.toContain("ai budget");
  expect(body).not.toContain("token budget");
  expect(body).not.toContain("guard trips");
  expect(body).not.toContain("circuit");
});