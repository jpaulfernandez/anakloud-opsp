import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T05 end to end: the matrix-grid input (Q5) against a real Postgres (same
// opt-in as the other DB-gated integration specs — SKIP unless DATABASE_URL and
// SESSION_SECRET are present). It covers the ticket: the 9×4 grid on a wide
// viewport with the pivot offered as a keyboard-reachable toggle, the column-
// major pivot on a narrow viewport with a "1 of 4" sub-progress indicator that
// does not touch the shell's "5 of 15" progress, and Continue staying blocked
// until at least one cell is marked (roles may be marked in none of the
// columns, but an entirely empty matrix is not an answer).
//
// The "both presentations write identical payloads" acceptance lives in the
// unit tests: both the grid checkbox and the pivot multi-select write through
// `toggleRole`, which keeps each column's role array in registry order, so the
// two presentations are identical by construction rather than by happy-accident.

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

  // One acknowledged, unsubmitted respondent (past the ground-rules gate) so
  // the Q5 URL is reachable.
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Matrix Grid', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Matrix Person', $3, 'MXG1', false, now())`,
    [RESPONDENT, COHORT, `matrix-grid-e2e-${run}`],
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

test("a wide viewport renders the 9×4 grid and offers the pivot as a keyboard toggle", async ({
  page,
}) => {
  await setSession(page);
  // Wide by default (Desktop Chrome).
  await page.goto("/q/5");

  // The true grid: nine role rows across the four specified columns.
  const grid = page.getByTestId("matrix-grid");
  await expect(grid).toBeVisible();
  for (const header of ["Pays us", "Decides to adopt", "Uses it most days", "Benefits most"]) {
    await expect(grid.getByRole("columnheader", { name: header })).toBeVisible();
  }
  await expect(page.locator("input[type=checkbox]")).toHaveCount(9 * 4);

  // The pivot is offered as a toggle on desktop too (§7 — the pivot is the
  // accessible path on all screen sizes). It is a real button, so it is in the
  // keyboard tab order; focusing and activating it switches to the pivot.
  const toggle = page.getByRole("button", { name: "Show one column at a time" });
  await expect(toggle).toBeVisible();

  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("matrix-pivot")).toBeVisible();
  await expect(page.getByTestId("matrix-sub-progress")).toHaveText("1 of 4");
});

test("a narrow viewport pivots to column-major screens whose sub-progress does not touch the main progress", async ({
  page,
}) => {
  await setSession(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/q/5");

  // Column-major pivot: one column per screen, nine items per screen.
  const pivot = page.getByTestId("matrix-pivot");
  await expect(pivot).toBeVisible();
  await expect(pivot.locator("input[type=checkbox]")).toHaveCount(9);

  // Sub-progress reads "1 of 4" while the main questionnaire progress still
  // reads the same "5 of 15" — the four screens are all Q5, not four questions.
  await expect(page.getByTestId("matrix-sub-progress")).toHaveText("1 of 4");
  const mainProgress = page.getByText("5 of 15");
  await expect(mainProgress).toBeVisible();

  // Step through all four columns; the sub-progress advances while the main
  // count stays pinned, and the last column has no Next (the exit is the
  // shell's Continue). The pivot's own navigation is scoped to the pivot so it
  // never collides with the Next.js dev-tools button in the dev overlay.
  for (const expected of ["2 of 4", "3 of 4", "4 of 4"]) {
    await pivot.getByRole("button", { name: "Next" }).click();
    await expect(page.getByTestId("matrix-sub-progress")).toHaveText(expected);
    await expect(mainProgress).toBeVisible();
  }
  await expect(pivot.getByRole("button", { name: "Next" })).toHaveCount(0);

  // Back steps back through the screens.
  await pivot.getByRole("button", { name: "Back" }).click();
  await expect(page.getByTestId("matrix-sub-progress")).toHaveText("3 of 4");
});

test("Continue stays blocked until at least one cell is marked", async ({ page }) => {
  await setSession(page);
  await page.goto("/q/5");

  // An entirely empty matrix is not an answer: Continue is refused with the
  // explanatory line rather than a generic disabled state (F03-T01, FR-9).
  const continueButton = page.getByRole("button", { name: "Continue" });
  await continueButton.click();
  await expect(page.getByText("Answer this before moving on.")).toBeVisible();
  await expect(page).toHaveURL(/\/q\/5$/);

  // Marking a single role in one column counts — a role may be in none of the
  // columns, so one mark anywhere unblocks Continue.
  await page.getByRole("checkbox", { name: /parent/i }).first().click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page).toHaveURL(/\/q\/6$/);
});