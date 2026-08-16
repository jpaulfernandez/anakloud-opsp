import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F03-T12 accessibility conformance, acceptance "a keyboard-only run through
// all fifteen questions completes in E2E" (ui_ux §7). This is the real protest
// against the touch-first QA trap: a respondent who cannot use a mouse must be
// able to finish the whole questionnaire, so every interaction here is driven
// with keyboard events only — no `click()`, no `check()`, no drag.
//
// Every value-change an app control can make is made through the keyboard:
//
// - text fields are filled with `keyboard.type` after `focus()`
// - radios, checkboxes and toggle buttons are activated with `Space`/`Enter`
// - pool cards and Continue are activated with `Enter`
// - the confidence and hours sliders are stepped with the arrow keys
// - a native <select> is changed with an arrow key
//
// The one deliberate exception is Q10(d)'s `<input type="month">`: a native
// browser control whose keyboard operation (tab into it, type digits, arrow
// between fields) is provided by the browser, not by the app — its YYYY-MM
// wiring is already exercised by q10.spec. Filling it directly does not test
// any app code path.
//
// The run starts at /q/1 and continues question by question to /q/15, where the
// optional final question has no Continue. Reaching /q/15 and operating its
// field is the completion the acceptance demands.

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

  // One acknowledged, unsubmitted respondent plus two teammates in the same
  // cohort, so Q14(b)'s roster actually renders its per-teammate selects (an
  // empty roster would leave Q14 with no select to operate).
  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Keyboard', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Keyboard Person', $3, 'KBD1', false, now())`,
    [RESPONDENT, COHORT, `keyboard-e2e-${run}`],
  );
  for (const [index, name] of ["Teammate One", "Teammate Two"].entries()) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
          ground_rules_acknowledged_at)
       values ($1, $2, $3, $4, $5, false, now())`,
      [randomUUID(), COHORT, name, `keyboard-e2e-teammate-${run}-${index}`, "KBT1"],
    );
  }
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

// Keyboard-only interaction helpers: focus to reach the control (as Tab would),
// then drive it with keyboard events only.

async function typeText(page: Page, locator: Locator, text: string) {
  await locator.focus();
  await page.keyboard.type(text);
}

async function pressSpace(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Space");
}

async function pressButton(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Enter");
}

async function stepSlider(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("ArrowRight");
}

async function advance(page: Page, expectedId: number) {
  await pressButton(page, page.getByRole("button", { name: "Continue" }));
  await expect(page).toHaveURL(new RegExp(`/q/${expectedId}$`));
}

const confidence = (page: Page) =>
  page.getByRole("slider", { name: "Confidence" });

test("a respondent completes all fifteen questions with the keyboard alone", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/1");

  // Q1 — long text (200-char minimum).
  await typeText(
    page,
    page.getByLabel("Your answer"),
    "Families of children with developmental delays book therapies over Viber, notes live in notebooks and no one can show whether a child is improving. Every center keeps its own version of the same data and parents fly blind between sessions. Anakloud makes the one shared record that connects the clinic, the therapist and the parent.",
  );
  await advance(page, 2);

  // Q2 — sentence completion (inline runs on the wide viewport; the stacked
  // variant is display:none at this width, so target the inline container).
  const inline = page.getByTestId("q2-sentence-inline");
  await typeText(
    page,
    inline.getByLabel("The people who would miss it most are"),
    "the therapy center owners",
  );
  await typeText(
    page,
    inline.getByLabel("because"),
    "their notes stop being legible to anyone else",
  );
  await advance(page, 3);

  // Q3 — metric triple + confidence. Scope to the triple container so the
  // "Number" field does not collide with the confidence number input.
  const metricTriple = page.getByTestId("metric-triple");
  await typeText(
    page,
    metricTriple.getByLabel("What would you count?"),
    "hours of therapy delivered with the shared record each month",
  );
  await typeText(page, metricTriple.getByLabel("Number"), "1500");
  await typeText(page, metricTriple.getByLabel("Unit"), "hours");
  await typeText(page, metricTriple.getByLabel("Why that one?"), "it is the number the whole clinic runs on");
  await stepSlider(page, confidence(page));
  await advance(page, 4);

  // Q4 — capped short text + confidence.
  await typeText(
    page,
    page.getByTestId("capped-short-text-input"),
    "the national record for every child receiving therapy",
  );
  await stepSlider(page, confidence(page));
  await advance(page, 5);

  // Q5 — matrix grid: one checkbox via the keyboard (a role marked anywhere is
  // enough to make Q5 answered).
  await pressSpace(page, page.getByRole("checkbox").first());
  await advance(page, 6);

  // Q6 — single choice + required reason.
  await pressSpace(page, page.getByRole("radio", { name: /Parent/ }).first());
  await expect(page.getByLabel("One line: why")).toBeEnabled();
  await typeText(page, page.getByLabel("One line: why"), "serve the one who is actually in the session");
  await advance(page, 7);

  // Q7 — capped short text + confidence.
  await typeText(
    page,
    page.getByTestId("capped-short-text-input"),
    "keep the shared record in one place the therapist updates live",
  );
  await stepSlider(page, confidence(page));
  await advance(page, 8);

  // Q8 — tap-to-assign ranking + confidence.
  for (let i = 0; i < 4; i += 1) {
    await pressButton(
      page,
      page.getByTestId("rank-pool").locator("button").first(),
    );
    await expect(
      page.getByTestId("rank-ordered").locator("li"),
    ).toHaveCount(i + 1);
  }
  // Reorder an ordered item with its explicit up control (ui_ux §7 alternative
  // to tapping), then delete-one radio and its why.
  const moveUp = page.getByRole("button", { name: /Move .* up/ });
  await pressButton(page, moveUp.nth(1));
  await pressSpace(page, page.getByRole("radio", { name: /ParentUp/ }).first());
  await typeText(page, page.getByLabel("One line why"), "it is the easiest one to rebuild later");
  // The initially collapsed predicted-group ranking, completed by keyboard too.
  await pressButton(
    page,
    page.getByRole("button", {
      name: "What do you think the group's #1 will be?",
    }),
  );
  for (let i = 0; i < 4; i += 1) {
    await pressButton(
      page,
      page.getByTestId("predicted-pool").locator("button").first(),
    );
    await expect(
      page.getByTestId("predicted-ordered").locator("li"),
    ).toHaveCount(i + 1);
  }
  await stepSlider(page, confidence(page));
  await advance(page, 9);

  // Q9 — three short fields.
  await typeText(page, page.getByLabel("Not doing 1"), "no hardware distribution channels");
  await typeText(page, page.getByLabel("Not doing 2"), "no consumer marketing spend");
  await typeText(page, page.getByLabel("Not doing 3"), "no hiring a big operations team");
  await advance(page, 10);

  // Q10 — money parts + confidence. The native month picker is filled directly
  // (its keyboard operation is the browser's), everything else by keyboard.
  await pressSpace(
    page,
    page.locator('input[name="q10-payer"]').first(),
  );
  await pressSpace(
    page,
    page.locator('input[name="q10-model"]').first(),
  );
  await typeText(page, page.getByLabel("What do they pay, in pesos?"), "15000");
  await page.getByTestId("q10-month-picker").fill("2026-12");
  await stepSlider(page, confidence(page));
  await advance(page, 11);

  // Q11 — paired rows (block one only is required) + optional star + confidence.
  await typeText(page, page.getByLabel("What").first(), "reshape the build into weekly bets");
  await typeText(
    page,
    page.getByLabel("Done when").first(),
    "every bet is reviewable by 10 December",
  );
  await pressSpace(page, page.getByRole("radio", { name: /This is the most important one/ }).first());
  await stepSlider(page, confidence(page));
  await advance(page, 12);

  // Q12 — capped short text.
  await typeText(page, page.getByTestId("capped-short-text-input"), "prove the loop");
  await advance(page, 13);

  // Q13 — long text + most-likely-cause radio.
  await typeText(
    page,
    page.getByLabel("Your explanation"),
    "The team never picked one market, so the product kept growing in four directions at once and none of the four got built well enough to keep a customer. Fundraising stalled because the pitch changed every month.",
  );
  await pressSpace(page, page.getByRole("radio", { name: /we never picked one thing/ }));
  await advance(page, 14);

  // Q14 — function chips, a teammate select, the hours slider.
  const chips = page.getByTestId("function-chips").locator("button");
  await pressButton(page, chips.nth(0));
  await pressButton(page, chips.nth(1));
  await pressButton(page, chips.nth(2));
  await pressSpace(page, page.locator("select").first());
  await stepSlider(
    page,
    page.getByRole("slider", { name: "Hours per week" }),
  );
  await advance(page, 15);

  // Q15 — the optional final question: reachable, its field operable by
  // keyboard, and with no Continue (the questionnaire ends here).
  await expect(page).toHaveURL(/\/q\/15$/);
  await typeText(page, page.getByLabel("Your answer"), "The week the clinic demo won");
  await expect(page.getByText("15 of 15")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toHaveCount(0);
});