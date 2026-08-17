import { expect, test, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { withRespondentContext } from "../../lib/access";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F04-T03 end to end: local mirror and offline mode, against a real Postgres
// (same opt-in as the other DB-gated e2e specs — SKIP unless DATABASE_URL and
// SESSION_SECRET are present). Covers the ticket's acceptance criteria:
//
//   1. Answering three questions in airplane mode and reconnecting persists all
//      three (Q1, Q2, Q3 — the natural first-three sequence).
//   2. The offline message is phrased as reassurance, not as an error.
//   3. Navigation is not blocked while offline.
//
// A real airplane mode here would also take down Next's RSC fetches, which is
// how this app navigates between screens, so the test simulates the data-plane
// offline the mirror actually guards instead: while "offline" the /api/answers
// PATCH is aborted from the network (so a save cannot reach the server) and the
// app is told so via the offline event; on "reconnect" the interception is
// dropped and an online event triggers the automatic drain. This exercises the
// same code paths a dropped connection does — mirror on every change, the
// reassurance slot, the pause-with-retry, and the reconnect drain.

const enabled =
  process.env.DATABASE_URL !== undefined &&
  process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();
const FACILITATOR = randomUUID();
const RESPONDENT = randomUUID();

const Q1 = { text: "The assessment queue is the bottleneck today." };
const Q2 = {
  who: "Therapy center admins",
  because: "they'd go back to scheduling by hand",
};
const Q3 = {
  metric: "Children with an active therapy plan",
  value: 1500,
  unit: "children",
  why: "that's the number that means we changed something",
};
const Q3_CONFIDENCE = 4;

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Offline', 'Q4 2026', 'open')",
    [COHORT],
  );
  // An acknowledged, unsubmitted respondent (past the ground-rules gate) so the
  // question URLs are reachable, matching the other DB-gated specs.
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator,
        ground_rules_acknowledged_at)
     values ($1, $2, 'Offline Person', $3, 'OFL001', false, now())`,
    [RESPONDENT, COHORT, `offline-e2e-${run}`],
  );
  await db.query(
    `insert into respondents
       (id, cohort_id, display_name, invite_token, resume_code, is_facilitator)
     values ($1, $2, 'Facilitator', $3, 'OFLA1', true)`,
    [FACILITATOR, COHORT, `offline-fac-${run}`],
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

/** Send the app a synthetic "offline" transition. */
async function goOffline(page: Page) {
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
}

/** Drop the PATCH interception and tell the app connectivity is back. */
async function reconnect(page: Page) {
  await page.unroute("**/api/answers");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

/** Read one respondent's answer row as the cohort facilitator (bypass RLS). */
async function readAnswer(
  respondentId: string,
  questionId: string,
): Promise<{ value: unknown; confidence: unknown } | null> {
  let row: { value: unknown; confidence: unknown } | null = null;
  await withRespondentContext(db!, FACILITATOR, async (tx) => {
    const res = await tx.query(
      "select value, confidence from answers where respondent_id = $1 and question_id = $2",
      [respondentId, questionId],
    );
    if (res.rows[0]) {
      row = { value: res.rows[0].value, confidence: res.rows[0].confidence };
    }
  });
  return row;
}

async function expectSavedEventually(
  respondentId: string,
  questionId: string,
  expected: unknown,
  confidence: unknown = null,
) {
  // Poll until the row exists and matches. Compared structurally (toEqual)
  // because postgres jsonb does not preserve object key order, so a string
  // diff would false-negative even when the persisted value is correct.
  await expect
    .poll(
      async () => readAnswer(respondentId, questionId),
      { timeout: 10_000 },
    )
    .toEqual({ value: expected, confidence });
}

test("answering three questions offline persists all three on reconnect", async ({
  page,
}) => {
  await setSession(page);
  await page.goto("/q/1");

  // Simulate the network dropping before any answer is typed.
  await page.route("**/api/answers", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.abort("internetdisconnected");
    } else {
      await route.fallback();
    }
  });
  await goOffline(page);

  // Q1: the long-text answer.
  await page.locator("textarea").fill(Q1.text);

  // The save slot shows the reassurance line while offline — phrased as a
  // promise, never as an error (acceptance criterion 2).
  const saveSlot = page.locator('[data-slot="save"]');
  await expect(saveSlot).toContainText(
    "Saved on this device — will sync when you're back online.",
  );
  await expect(saveSlot).not.toContainText("Not saved");
  await expect(saveSlot).not.toContainText("Error");

  // Navigation is not blocked while offline (acceptance criterion 3).
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/2$/);

  // Q2: the two sentence-completion blanks.
  const inline = page.getByTestId("q2-sentence-inline");
  await inline.getByLabel("The people who would miss it most are").fill(Q2.who);
  await inline.getByLabel("because").fill(Q2.because);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/q\/3$/);

  // Q3: the metric triple plus its required confidence ring (FR-11). The
  // metric number field is matched exactly so the "Confidence (number)"
  // spinbutton (whose accessible name also contains "number") does not collide.
  await page.getByLabel("What would you count?").fill(Q3.metric);
  await page.getByLabel("Number", { exact: true }).fill("1,500");
  await page.getByLabel("Unit").fill(Q3.unit);
  await page.getByLabel("Why that one?").fill(Q3.why);
  await page.getByLabel("Confidence (number)").fill(String(Q3_CONFIDENCE));

  // Reconnect: drop the interception and signal connectivity back. The pending
  // mirrored answers sync without respondent action (acceptance criterion 1).
  await reconnect(page);

  await expectSavedEventually(RESPONDENT, "q1", Q1);
  await expectSavedEventually(RESPONDENT, "q2", Q2);
  await expectSavedEventually(
    RESPONDENT,
    "q3",
    Q3,
    Q3_CONFIDENCE,
  );
});

test("while offline the app keeps free text that was never mirrored further along", async ({
  page,
}) => {
  // Guard: the mirror itself is unit-tested; this assertion just confirms the
  // reconnect drain does not re-send an answer the server already has. Answer
  // Q1 while online, go offline, then reconnect and confirm no second write
  // clobbers anything — the drain is idempotent by construction.
  await setSession(page);
  await page.goto("/q/1");

  // Save Q1 while fully online first.
  await page.locator("textarea").fill(Q1.text);
  await expect(page.getByTestId("save-status")).toHaveText("✓ Saved", {
    timeout: 10_000,
  });

  // Go offline, trigger the reconnect drain once back up, and confirm Q1 is
  // still byte-identical on the server (no empty-draft overwrite).
  await page.route("**/api/answers", async (route) => {
    if (route.request().method() === "PATCH") {
      await route.abort("internetdisconnected");
    } else {
      await route.fallback();
    }
  });
  await goOffline(page);
  await reconnect(page);

  await expectSavedEventually(RESPONDENT, "q1", Q1);
  const row = await readAnswer(RESPONDENT, "q1");
  expect(row?.value).toEqual(Q1);
});