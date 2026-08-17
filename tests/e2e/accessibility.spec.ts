import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T12 accessibility conformance, acceptance "automated axe pass on every
// question screen with zero serious or critical violations" (ui_ux §7) against
// a real Postgres, on the same opt-in as the other DB-gated integration e2e
// specs.
//
// axe is run broad (the full axe-core rule set), and any serious or critical
// violation — colour-contrast, scrollable-region-focusable, label, landmark,
// whatever — fails the assertion. That is the ticket's bar: not a trimmed
// rule list that happens to pass, but the throughput standard of zero serious
// or critical findings on the whole questionnaire surface.
//
// Two states are scanned in addition to each fresh screen because they are the
// ones most likely to regress contrast or focusability:
//
// - Q5's pivoted form — the accessible path on all screen sizes (ui_ux §7).
// - Q14 at the three-chip cap, when the remaining chips dim (F03-T09): the dim
//   must still be a compliant state, never a genuinely unreadable control.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const RESPONDENT = randomUUID();

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  // One acknowledged, unsubmitted respondent so every question URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Accessibility', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'A11y Person', $3, 'AXE1', false, now())`,
    [RESPONDENT, COHORT, `accessibility-e2e-${run}`],
  );
});

test.afterAll(async () => {
  if (db) {
    await db
      .query("delete from respondents where cohort_id = $1", [COHORT])
      .catch(() => {});
    await db.query("delete from cohorts where id = $1", [COHORT]).catch(() => {});
    await db.end();
  }
});

async function setSession(page: Page) {
  const sessionToken = createSessionToken({
    respondentId: RESPONDENT,
    cohortId: COHORT,
  });
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: sessionToken,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

/** The serious-or-critical subset of an axe run, as readable findings. */
async function seriousFindings(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => {
      const nodes = v.nodes.map((n) => n.target.join(" ")).slice(0, 4).join("; ");
      return `${v.id} [${v.impact}] "${v.help}" — ${nodes}`;
    });
}

test("every question screen passes axe with zero serious or critical violations", async ({
  page,
}) => {
  await setSession(page);

  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    await page.goto(`/q/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const findings = await seriousFindings(page);
    expect(
      findings,
      `axe serious/critical violations on /q/${id}`,
    ).toEqual([]);
  }
});

test("Q5's pivoted form passes axe", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/5");

  // Force the pivot open on the wide test viewport (the accessible path is
  // offered on all sizes, ui_ux §7) and flip between its columns so each
  // column screen is scanned.
  await page.getByRole("button", { name: "Show one column at a time" }).click();
  const pivotNext = page
    .getByTestId("matrix-pivot")
    .getByRole("button", { name: "Next" });
  for (let step = 0; step < 4; step += 1) {
    const findings = await seriousFindings(page);
    expect(findings, `axe on Q5 pivot column ${step + 1}`).toEqual([]);
    if ((await pivotNext.count()) > 0) {
      await pivotNext.click();
    }
  }
});

test("Q14's three-chip cap keeps the dimmed chips in a compliant state", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/14");

  // Select (at most) three functions so the remainder dim; then scan the whole
  // screen, including the dimmed chips and the cap message.
  const chips = page.getByTestId("function-chips").locator("button");
  const count = await chips.count();
  for (let i = 0; i < Math.min(3, count); i += 1) {
    await chips.nth(i).click();
  }
  // Tapping a dimmed chip produces the message (F03-T09 acceptance) — and the
  // scan happens with the message on screen too.
  const message = page.getByTestId("cap-message");
  if ((await message.count()) === 0) {
    await chips.nth(Math.min(3, count - 1)).click();
  }
  const findings = await seriousFindings(page);
  expect(findings, "axe on Q14 at cap").toEqual([]);
  await expect(page.getByTestId("cap-message")).toBeVisible();
});