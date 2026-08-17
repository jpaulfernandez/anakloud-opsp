import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";
import { upsertAnswer } from "../../lib/answers";
import { withRespondentContext } from "../../lib/access";

// F06-T01 end to end: the review screen against a real Postgres, on the same
// opt-in as the other integration e2e specs (SKIP unless DATABASE_URL and
// SESSION_SECRET are present). It covers the three acceptance criteria: an
// edit link returns to the question and then back to review (never on to the
// next question), skipped optional questions appear under the verbatim
// "You skipped these — that's allowed." heading, and the submit button is
// visually de-emphasised until every required question is answered. The
// reviewer also sees their own q14(d) private note.

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

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Review', 'Q4 2026', 'open')",
    [COHORT],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Review Person', $3, 'RVR1', false, now())`,
    [RESPONDENT, COHORT, `review-e2e-${run}`],
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

/** Answer values, written via upsertAnswer inside the respondent's RLS context. */
async function seedAllAnswers(omit: ReadonlySet<string> = new Set()) {
  await withRespondentContext(db!, RESPONDENT, async (tx) => {
    const put = (questionId: string, value: unknown) =>
      omit.has(questionId)
        ? undefined
        : upsertAnswer(tx, { respondent_id: RESPONDENT, question_id: questionId, value });
    const ops = [
      put("q1", { text: "Movement data is locked inside notebooks." }),
      put("q2", { who: "the therapists", because: "their notes live on paper" }),
      put("q3", { metric: "centers onboarded", value: 40, unit: "per year", why: "scale" }),
      put("q4", { text: "Every PH child with a delay gets early help." }),
      put("q5", { pays: ["parent"], decides: ["center_owner"], uses: ["therapist"], benefits: ["child"] }),
      put("q6", { choice: "center", why: "we sell to centers" }),
      put("q7", { text: "the only system built for PH clinics" }),
      put("q8", { rank: ["pedconnect", "teachday", "parentup", "pedmd"], delete: "pedmd", why: "lowest pull", predicted: ["teachday", "pedconnect", "parentup", "pedmd"] }),
      put("q9", { items: ["no HR tools", "no billing", "no app store"] }),
      put("q10", { payer: "parent", model: "per active child per month", amount: 500, unit: "pesos", first_peso: "2026-11" }),
      put("q11", { rocks: [{ what: "ship beta", done_when: "30 Sept" }], starred: 0 }),
      put("q12", { text: "Prove the door opens" }),
      put("q13", { text: "we ran out of money", cause: "ran out of money" }),
      put("q14", { wants: ["product"], others: {}, hours: 12, private_note: "worried about the runway" }),
      put("q15", { text: "Maya pushed the beta out the door." }),
    ].filter((o) => o !== undefined) as Promise<void>[];
    await Promise.all(ops);
  });
}

function submitButton(page: Page) {
  return page.getByTestId("review-submit");
}

test("editing from review returns to review, not to the next question", async ({ page }) => {
  await setSession(page);
  await seedAllAnswers();

  await page.goto("/review");
  await expect(page).toHaveURL(/\/review$/);
  // The edit link takes us back to the question with the review marker.
  await page.getByTestId("edit-q3").click();
  await expect(page).toHaveURL(/\/q\/3\?from=review$/);

  // Continue on that screen returns to review — the next question stays hidden.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review your answers");
});

test("skipped optional questions appear under the 'skipped' heading with non-judgemental copy", async ({
  page,
}) => {
  await setSession(page);
  await seedAllAnswers(new Set(["q15"]));

  await page.goto("/review");
  await expect(
    page.getByRole("heading", { name: "You skipped these — that's allowed." }),
  ).toBeVisible();
  await expect(page.getByText("A moment worth copying")).toBeVisible();
  // The skipped item offers an Answer link back into the question.
  await expect(page.getByRole("link", { name: "Answer" })).toBeVisible();
});

test("submit is visually de-emphasised until every required question is answered", async ({ page }) => {
  await setSession(page);

  // Incomplete: the required q3 is unanswered → secondary styling.
  await seedAllAnswers(new Set(["q3"]));
  await page.goto("/review");
  await expect(submitButton(page)).toHaveClass(/border/);
  await expect(submitButton(page)).not.toHaveClass(/bg-neutral-900/);

  // Complete the required set → the button switches to the primary style.
  await seedAllAnswers();
  await page.goto("/review");
  await expect(submitButton(page)).toHaveClass(/bg-neutral-900/);
  await expect(submitButton(page)).not.toHaveClass(/border/);
});

test("the review shows the respondent's own q14(d) private note", async ({ page }) => {
  await setSession(page);
  await seedAllAnswers();

  await page.goto("/review");
  await expect(page.getByTestId("private-note")).toBeVisible();
  await expect(page.getByText("worried about the runway")).toBeVisible();
  await expect(page.getByText("Only Paul sees this one.")).toBeVisible();
});

// F06-T02 — submit confirmation (FR-14, ui_ux.md §4.13). The review screen's
// submit action opens a confirmation dialog carrying verbatim §4.13 copy;
// `[ Not yet ]` closes it and returns to review with nothing changed; and the
// only "Submit and lock" that can lead to a submit lives inside that dialog,
// so no path submits on a single click without passing through it.

test("submit confirmation copy matches ui_ux.md §4.13", async ({ page }) => {
  await setSession(page);
  await seedAllAnswers();

  await page.goto("/review");
  await submitButton(page).click();

  const dialog = page.getByTestId("submit-confirmation");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Submitting locks your answers." }),
  ).toBeVisible();
  await expect(dialog).toContainText(
    "You won't be able to change them afterwards — that's deliberate, so the baseline stays a baseline. You'll still be able to edit the OPSP that gets built from them.",
  );
  await expect(page.getByRole("button", { name: "Not yet" })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Submit and lock" }),
  ).toBeVisible();
});

test("'Not yet' returns to review with nothing changed", async ({ page }) => {
  await setSession(page);
  await seedAllAnswers();

  await page.goto("/review");
  await submitButton(page).click();
  await expect(page.getByTestId("submit-confirmation")).toBeVisible();

  await page.getByRole("button", { name: "Not yet" }).click();

  await expect(page.getByTestId("submit-confirmation")).not.toBeVisible();
  await expect(page).toHaveURL(/\/review$/);
  // Nothing changed: the answers and the primary submit button are still intact.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review your answers");
  await expect(page.getByTestId("summary-q3")).toContainText("centers onboarded");
  await expect(submitButton(page)).toHaveClass(/bg-neutral-900/);
});

test("no submit path bypasses the confirmation", async ({ page }) => {
  await setSession(page);
  await seedAllAnswers();

  await page.goto("/review");

  // The review screen's submit button does not submit on its own — it only
  // reveals the confirmation dialog, and the page is otherwise unchanged.
  await submitButton(page).click();
  await expect(page.getByTestId("submit-confirmation")).toBeVisible();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review your answers");

  // The only "Submit and lock" that can lead to a submit is inside the dialog.
  await expect(
    page.getByTestId("submit-confirmation").getByRole("button", {
      name: "Submit and lock",
    }),
  ).toBeVisible();
});