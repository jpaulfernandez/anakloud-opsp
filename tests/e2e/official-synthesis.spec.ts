import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { migrate } from "../../lib/migrate";
import { createSessionToken, SESSION_COOKIE } from "../../lib/session";

// F15-T04 end to end — the synthesis endpoint with the conflict guard (`POST
// /api/admin/synthesise`) and the explicit accept/discard routes (FR-38,
// FR-39, FR-40), against a real Postgres on the same opt-in as the other
// DB-gated specs (SKIP unless DATABASE_URL and SESSION_SECRET are present).
//
// With the key removed (the L2 local default), the guard can never clear, so a
// synthesis from two clearly incompatible seeded answers is structurally
// refused — there is no route, parameter or flag that yields a draft from
// them. The draft lifecycle itself (store → visible draft → explicit accept)
// is exercised at the unit/integration seams and would need a live model at
// L0; this spec pins the deterministic refusal and the access/400 contracts,
// plus that a refused synthesis never writes a draft onto the cell.
//
// The spec is serial within the file like the other DB suites.

const enabled =
  process.env.DATABASE_URL !== undefined && process.env.SESSION_SECRET !== undefined;

test.skip(!enabled, "requires DATABASE_URL and SESSION_SECRET");

test.describe.configure({ mode: "serial" });

const run = randomBytes(4).toString("hex");
const COHORT = randomUUID();

const FAC = randomUUID(); // submitted facilitator → allowed
const UNSUB = randomUUID(); // facilitator, submitted=false → 403
const RESP = randomUUID(); // not a facilitator → 403
const CENTRE = randomUUID(); // centre-camp answer (incompatible with PARENT)
const PARENT = randomUUID(); // parent-camp answer

let db: Client | null = null;

test.beforeAll(async () => {
  if (!enabled) return;
  db = new Client({ connectionString: process.env.DATABASE_URL! });
  await db.connect();
  await migrate(db);

  await db.query(
    "insert into cohorts (id, name, quarter_label, status) values ($1, 'E2E Synthesis', 'Q4 2026', 'open')",
    [COHORT],
  );

  for (const row of [
    { id: FAC, name: "Facilitator Synth", token: "SYFA1", isFac: true, submitted: new Date() },
    { id: UNSUB, name: "Unsubmitted Facilitator", token: "SYFA2", isFac: true, submitted: null },
    { id: RESP, name: "Respondent Synth", token: "SYRP1", isFac: false, submitted: null },
    { id: CENTRE, name: "Centre Camp", token: "SYCT1", isFac: false, submitted: null },
    { id: PARENT, name: "Parent Camp", token: "SYPT1", isFac: false, submitted: null },
  ] as const) {
    await db.query(
      `insert into respondents
         (id, cohort_id, display_name, invite_token, resume_code, is_facilitator, submitted_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [row.id, COHORT, row.name, `sy-${run}-${row.token}`, row.token, row.isFac, row.submitted],
    );
  }

  // The two clearly incompatible public Q6 answers (the seed's confident split).
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q6', $3::jsonb, false, null)`,
    [
      randomUUID(),
      CENTRE,
      JSON.stringify({
        choice: "center",
        why: "They pay, and if they churn there is no data for the parent to look at anyway.",
      }),
    ],
  );
  await db.query(
    `insert into answers (id, respondent_id, question_id, value, is_private, confidence)
     values ($1, $2, 'q6', $3::jsonb, false, null)`,
    [
      randomUUID(),
      PARENT,
      JSON.stringify({
        choice: "parent",
        why: "The parent is the human we are actually here for; everything else is infrastructure.",
      }),
    ],
  );
});

// Clear the shared official draft before each test so each case starts clean.
test.beforeEach(async () => {
  if (enabled && db) {
    await db
      .query("delete from opsp_drafts where owner_type = 'official' and cohort_id = $1", [COHORT])
      .catch(() => {});
  }
});

test.afterAll(async () => {
  if (db) {
    const { rows } = await db.query<{ id: string }>(
      "select id from respondents where cohort_id = $1",
      [COHORT],
    );
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      await db.query("delete from opsp_drafts where cohort_id = $1", [COHORT]);
      await db.query("delete from ai_interactions where cohort_id = $1", [COHORT]);
      await db.query("delete from answers where respondent_id = any($1::uuid[])", [ids]);
    }
    await db.query("delete from respondents where cohort_id = $1", [COHORT]);
    await db.query("delete from cohorts where id = $1", [COHORT]);
    await db.end();
  }
});

/** The Cookie header that presents a session for the given respondent. */
function sessionCookie(respondentId: string): string {
  const token = createSessionToken({ respondentId, cohortId: COHORT });
  return `${SESSION_COOKIE}=${token}`;
}

/** Attach one of the two incompatible answers to the given cell as a card. */
async function attach(cellId: string, respondentId: string) {
  const res = await fetch(`http://127.0.0.1:3000/api/admin/official-opsp/source-cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: sessionCookie(FAC) },
    body: JSON.stringify({ cellId, respondentId, questionId: "q6" }),
  });
  return res.status;
}

async function latestBhag(): Promise<{ value: unknown; draft: unknown }> {
  const { rows } = await db!.query<{ cells: { bhag?: { value: unknown; draft: unknown } } }>(
    `select cells from opsp_drafts
      where owner_type = 'official' and cohort_id = $1
      order by version desc limit 1`,
    [COHORT],
  );
  const bhag = rows[0]?.cells?.bhag;
  return { value: bhag?.value ?? null, draft: bhag?.draft ?? null };
}

/** The raw `conflict` block seeded on the latest official draft. */
async function seedConflict(cellId: string): Promise<{ reason: string; positions: unknown[] }> {
  await attach(cellId, CENTRE);
  await attach(cellId, PARENT);
  const { rows } = await db!.query<{ version: number; cells: Record<string, unknown> }>(
    `select version, cells from opsp_drafts
      where owner_type = 'official' and cohort_id = $1
      order by version desc limit 1`,
    [COHORT],
  );
  const cell = (rows[0].cells as Record<string, Record<string, unknown>>)[cellId];
  const sourceCards = (cell.sourceCards as {
    id: string;
    respondentId: string;
    respondentName: string;
    questionId: string;
    text: string;
  }[]).map((card) => ({ ...card }));
  const conflict = {
    id: randomUUID(),
    reason: "These say opposite things about who the core customer is.",
    positions: sourceCards,
  };
  (rows[0].cells as Record<string, Record<string, unknown>>)[cellId] = {
    ...cell,
    conflict,
  };
  await db!.query(
    `insert into opsp_drafts (id, cohort_id, owner_type, owner_id, version, cells)
     values ($1, $2, 'official', null, $3, $4::jsonb)`,
    [randomUUID(), COHORT, rows[0].version + 1, JSON.stringify(rows[0].cells)],
  );
  return conflict;
}

test("a respondent and an unsubmitted facilitator cannot synthesise (403)", async ({
  request,
}) => {
  for (const path of [
    "/api/admin/synthesise",
    "/api/admin/synthesise/accept",
    "/api/admin/synthesise/discard",
  ]) {
    const asRespondent = await request.post(path, {
      headers: { cookie: sessionCookie(RESP) },
      data: { cellId: "bhag" },
    });
    expect(asRespondent.status(), `${path} as respondent`).toBe(403);

    const asUnsubmitted = await request.post(path, {
      headers: { cookie: sessionCookie(UNSUB) },
      data: { cellId: "bhag" },
    });
    expect(asUnsubmitted.status(), `${path} unsubmitted`).toBe(403);
  }
});

test("a cell with fewer than two source cards is a 400 across the synthesis routes", async ({
  request,
}) => {
  for (const path of ["/api/admin/synthesise", "/api/admin/synthesise/accept"]) {
    const res = await request.post(path, {
      headers: { cookie: sessionCookie(FAC) },
      data: { cellId: "bhag" },
    });
    expect(res.status(), `${path} no cards`).toBe(400);

    const bad = await request.post(path, {
      headers: { cookie: sessionCookie(FAC) },
      data: { cellId: "not-a-cell" },
    });
    expect(bad.status(), `${path} bad cell`).toBe(400);
  }
});

test("two incompatible seeded answers refuse to synthesise — no draft, never a statement", async ({
  request,
}) => {
  expect(await attach("bhag", CENTRE)).toBe(200);
  expect(await attach("bhag", PARENT)).toBe(200);

  const res = await request.post("/api/admin/synthesise", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag" },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    status: string;
    cellId: string;
    reason?: string;
    statement?: string;
  };
  expect(body.ok).toBe(true);
  expect(body.status).toBe("refused");
  expect(body.cellId).toBe("bhag");
  // The refusal is a reason with the conflict, not a drafted statement.
  expect(body.statement).toBeUndefined();
  expect(body.reason).toBeTruthy();

  // The cell is untouched: no draft was written (FR-40 / conflict guard).
  const bhag = await latestBhag();
  expect(bhag.value).toBeNull();
  expect(bhag.draft).toBeNull();

  // Exactly one synthesis interaction row: the guard's classification call.
  // The draft call never runs because the guard did not clear.
  const { rows } = await db!.query<{ purpose: string; question_id: string | null }>(
    `select purpose, question_id from ai_interactions
      where cohort_id = $1 and purpose = 'synthesis'`,
    [COHORT],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].purpose).toBe("synthesis");
  expect(rows[0].question_id).toBeNull();
});

test("accepting with no pending draft is a 400 — acceptance is never automatic", async ({
  request,
}) => {
  const res = await request.post("/api/admin/synthesise/accept", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag" },
  });
  expect(res.status()).toBe(400);

  const discard = await request.post("/api/admin/synthesise/discard", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag" },
  });
  expect(discard.status()).toBe(400);
});

test("the canvas shows the refusal, with no draft and no merge affordance (key removed)", async ({
  page,
}) => {
  await attach("bhag", CENTRE);
  await attach("bhag", PARENT);

  await page.context().addCookies([
    { name: SESSION_COOKIE, value: createSessionToken({ respondentId: FAC, cohortId: COHORT }), domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/admin/official-opsp");

  await expect(page.getByTestId("opsp-synthesise-bhag")).toBeVisible();
  await page.getByTestId("opsp-synthesise-bhag").click();

  // With the key removed the classification is a refusal; the reason is shown.
  const verdict = page.getByTestId("opsp-classification-bhag");
  await expect(verdict).toBeVisible();
  await expect(verdict).toContainText("Not compatible");

  // No draft exists, so there is nothing to accept, and no "Draft statement"
  // affordance appears for a refused classification.
  await expect(page.getByTestId("opsp-draft-statement-bhag")).toHaveCount(0);
  await expect(page.getByTestId("opsp-draft-accept-bhag")).toHaveCount(0);
});

test("the record-decision route is admin-gated (403)", async ({ request }) => {
  // Seed a conflict so the auth check is reached rather than a 400.
  await seedConflict("bhag");

  const asRespondent = await request.post("/api/admin/synthesise/record-decision", {
    headers: { cookie: sessionCookie(RESP) },
    data: { cellId: "bhag", positionId: "whatever" },
  });
  expect(asRespondent.status()).toBe(403);

  const asUnsubmitted = await request.post("/api/admin/synthesise/record-decision", {
    headers: { cookie: sessionCookie(UNSUB) },
    data: { cellId: "bhag", positionId: "whatever" },
  });
  expect(asUnsubmitted.status()).toBe(403);
});

test("recording a decision is a 400 without a conflict or with an unknown position", async ({
  request,
}) => {
  // No conflict: two cards attached to one cell, but no conflict state on it.
  await attach("purpose", CENTRE);
  await attach("purpose", PARENT);
  const noConflict = await request.post("/api/admin/synthesise/record-decision", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "purpose", positionId: "whatever" },
  });
  expect(noConflict.status()).toBe(400);

  // A real conflict on bhag, but the chosen position is not one of its two.
  const conflict = await seedConflict("bhag");
  const unknown = await request.post("/api/admin/synthesise/record-decision", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag", positionId: "does-not-exist" },
  });
  expect(unknown.status()).toBe(400);
  expect(conflict.positions).toHaveLength(2);
});

test("recording a decision stores the chosen position and the decider", async ({
  request,
}) => {
  const conflict = (await seedConflict("bhag")) as unknown as {
    positions: { id: string; text: string; respondentName: string }[];
  };
  const chosen = conflict.positions[1];

  const res = await request.post("/api/admin/synthesise/record-decision", {
    headers: { cookie: sessionCookie(FAC) },
    data: { cellId: "bhag", positionId: chosen.id },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    ok: boolean;
    cells: {
      bhag: {
        value: string;
        marking: { type: string; mark: string };
        sources: string[];
        conflict: {
          decision: {
            positionId: string;
            chosenText: string;
            recorderId: string;
            recorderName: string;
          };
          positions: unknown[];
        };
      };
    };
  };
  expect(body.ok).toBe(true);
  // The chosen position becomes the cell content as ink.
  expect(body.cells.bhag.value).toBe(chosen.text);
  expect(body.cells.bhag.marking).toEqual({ type: "single", mark: "ink" });
  expect(body.cells.bhag.sources).toEqual(["q6"]);
  // The note captures which position and by whom.
  expect(body.cells.bhag.conflict.decision.positionId).toBe(chosen.id);
  expect(body.cells.bhag.conflict.decision.chosenText).toBe(chosen.text);
  expect(body.cells.bhag.conflict.decision.recorderName).toBe("Facilitator Synth");
  // Both positions remain visible after the decision.
  expect(body.cells.bhag.conflict.positions).toHaveLength(2);

  // The decision survives a reload of the same lineage.
  const bhag = await latestBhag();
  expect(bhag.value).toBe(chosen.text);
});

test("the canvas renders the conflict state with no merge affordance; a decision is recorded", async ({
  page,
}) => {
  const conflict = (await seedConflict("bhag")) as unknown as {
    positions: { id: string; text: string; respondentName: string }[];
  };

  await page.context().addCookies([
    { name: SESSION_COOKIE, value: createSessionToken({ respondentId: FAC, cohortId: COHORT }), domain: "127.0.0.1", path: "/" },
  ]);
  await page.goto("/admin/official-opsp");

  const block = page.getByTestId("opsp-conflict-bhag");
  await expect(block).toBeVisible();
  await expect(block).toContainText("These two don't reconcile. Someone has to choose.");

  // Both positions are shown side by side, attributed.
  await expect(page.getByTestId("opsp-conflict-position-bhag-0")).toBeVisible();
  await expect(page.getByTestId("opsp-conflict-position-bhag-1")).toBeVisible();
  await expect(page.getByTestId("opsp-conflict-attribution-bhag-0")).toContainText("Centre Camp");
  await expect(page.getByTestId("opsp-conflict-attribution-bhag-1")).toContainText("Parent Camp");

  // Exactly one affordance: a "Record the decision" control per position.
  await expect(page.getByTestId("opsp-record-decision-bhag-0")).toBeVisible();
  await expect(page.getByTestId("opsp-record-decision-bhag-1")).toBeVisible();

  // No control anywhere merges the positions (the absence of the button is
  // the feature — FR-39). No draft or statement affordance either.
  await expect(page.getByRole("button", { name: /merge/i })).toHaveCount(0);
  await expect(page.getByTestId("opsp-draft-statement-bhag")).toHaveCount(0);
  await expect(page.getByTestId("opsp-draft-accept-bhag")).toHaveCount(0);

  // Record the decision on the second position.
  await page.getByTestId("opsp-record-decision-bhag-1").click();

  await expect(page.getByTestId("opsp-conflict-chosen-bhag")).toBeVisible();
  await expect(page.getByTestId("opsp-conflict-note-bhag")).toContainText(
    "Decision recorded by Facilitator Synth",
  );
  // Both positions remain visible after the decision is recorded.
  await expect(page.getByTestId("opsp-conflict-position-bhag-0")).toBeVisible();
  await expect(page.getByTestId("opsp-conflict-position-bhag-1")).toBeVisible();
  // The chosen position filled the cell.
  await expect(page.getByTestId("opsp-content-bhag")).toContainText(conflict.positions[1].text);
});