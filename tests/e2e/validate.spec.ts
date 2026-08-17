import { expect, test } from "@playwright/test";

// F05-T03 end to end: POST /api/validate returns the deterministic Verdict for
// one answer over real HTTP, without a session cookie, without a database and
// without any AI provider — it is available at every degradation level by
// construction (tech_infrastructure.md §4). Unlike the DB-backed specs it does
// not skip, precisely because "always available" is the point: this must work
// in the barest environment, including the default verify run with no
// DATABASE_URL and no GEMINI_API_KEY.

test("returns an ok verdict for a passing answer", async ({ request }) => {
  const res = await request.post("/api/validate", {
    data: {
      question_id: "q9",
      value: {
        items: [
          "we will not chase enterprise contracts",
          "we will not build a mobile version",
          "we will not hire outside the team",
        ],
      },
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(true);
  expect(body.hint).toBeUndefined();
});

test("returns a failing verdict carrying the static hint and dimension", async ({
  request,
}) => {
  const res = await request.post("/api/validate", {
    data: {
      question_id: "q11",
      value: { rocks: [{ what: "x", done_when: "improve onboarding" }], starred: 0 },
    },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.dimension).toBe("measurability");
  expect(typeof body.hint).toBe("string");
  expect(body.hint).not.toBe("");
});

test("rejects an unknown question id with 400", async ({ request }) => {
  const res = await request.post("/api/validate", {
    data: { question_id: "q99", value: { text: "x" } },
  });
  expect(res.status()).toBe(400);
});

test("responds without a session cookie (no auth dependency)", async ({
  request,
}) => {
  // The request fixture sends no cookie: the endpoint must still answer 200.
  const res = await request.post("/api/validate", {
    data: { question_id: "q4", value: { text: "a single clear sentence here" } },
  });
  expect(res.status()).toBe(200);
});