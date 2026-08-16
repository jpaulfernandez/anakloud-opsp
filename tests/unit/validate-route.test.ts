import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { POST } from "../../app/api/validate/route";
import { STATIC_HINTS } from "../../lib/static-hints";

// The validation endpoint (F05-T03). The acceptances that matter here:
//   - no code path from /api/validate reaches the AI gateway module;
//   - it responds correctly with ANTHROPIC_API_KEY removed from the
//     environment;
//   - it is available without a session, a database or any config — the
//     request path is local computation only, so there is no setup to skip on.
//
// The handler takes a Web `Request`, so it is exercised directly with no server
// and no Postgres; the source-scan test below is what pins the "no AI path"
// guarantee at the code level, since the AI gateway does not exist yet (F12).

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

async function result(body: unknown) {
  const res = await post(body);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe("POST /api/validate — verdict for one answer", () => {
  it("returns ok for a passing answer", async () => {
    const { status, json } = await result({ question_id: "q7", value: { text: "one promise" } });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dimension).toBeUndefined();
  });

  it("returns a failing verdict with the dimension and the static hint", async () => {
    const { status, json } = await result({
      question_id: "q7",
      value: { text: "a, b, c and d and e" }, // four conjunctions → fails
    });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.dimension).toBe("single_answer");
    expect(json.hint).toBe(STATIC_HINTS.q7.hint);
  });

  it("never injects an example into the base verdict (examples are on request, F05-T04)", async () => {
    const { json } = await result({ question_id: "q11", value: { rocks: [] } });
    expect(json.ok).toBe(false);
    expect(json.dimension).toBe("measurability");
    expect(json.example).toBeUndefined();
  });

  it("treats a missing or malformed value as a failing answer, not a 400", async () => {
    const { status, json } = await result({ question_id: "q7" });
    expect(status).toBe(200);
    expect(json.ok).toBe(false);
    expect(json.hint).toBe(STATIC_HINTS.q7.hint);
  });

  it("rejects an unknown question id with 400", async () => {
    const { status } = await result({ question_id: "q99", value: { text: "x" } });
    expect(status).toBe(400);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const { status } = await result("not json");
    expect(status).toBe(400);
  });

  it("rejects a non-object body with 400", async () => {
    const { status } = await result(null);
    expect(status).toBe(400);
  });

  it("works with ANTHROPIC_API_KEY removed from the environment", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = undefined;
    try {
      const okRes = await result({ question_id: "q3", value: { metric: "x", value: 1, unit: "y", why: "" } });
      expect(okRes.status).toBe(200);
      expect(okRes.json.ok).toBe(true);

      const failRes = await result({ question_id: "q3", value: { metric: "", value: 1, unit: "y", why: "" } });
      expect(failRes.status).toBe(200);
      expect(failRes.json.ok).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });

  it("is available without a session cookie (no auth, no database)", async () => {
    const { status } = await post({ question_id: "q4", value: { text: "one clear statement" } });
    expect(status).toBe(200);
  });
});

describe("no code path reaches the AI gateway", () => {
  // The AI gateway (F12) does not exist yet, so the guarantee is pinned at the
  // code level: the validate route must import nothing that reads config or
  // could reach a provider. The exact-import assertion is the honest check — if
  // someone adds a single static import that touches config, secret-reading or
  // any provider SDK, the list changes and this fails. It also guards the
  // dynamic path: no `require`/`import()` appears anywhere in the route.
  const source = readFileSync(resolve("app/api/validate/route.ts"), "utf8");

  it("imports exactly the pure validator modules and the route runner", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
    // next/server is the route runner; everything else is a pure F05 module
    // that does no I/O and never reads an environment variable.
    expect(imports).toEqual([
      "next/server",
      "@/lib/validators",
      "@/lib/static-hints",
      "@/lib/answer-shape",
    ]);
  });

  it("performs no dynamic import or require", () => {
    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});