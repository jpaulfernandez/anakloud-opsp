import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anthropicProvider,
  geminiProvider,
  ProviderHttpError,
  ProviderSafetyError,
  ProviderShapeError,
  type ProviderRequest,
} from "../../lib/provider";
import { COACH_RESULT_TOOL } from "../../lib/coach-prompt";

// F13-T01 — the provider's structured-output (tool-use) mode. The coach must
// constrain the model to its `{verdict, dimension, hint, example}` schema, and
// that is enforced at the wire: when a request carries a `structuredOutput`
// directive the provider sends `system` + a single user turn + a forced tool,
// and returns the extracted tool input as its `text`. These tests fake
// `global.fetch` and assert both the outbound body and the inbound extraction.

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function jsonResponseFor(options: {
  input?: unknown;
  toolName?: string;
} = {}): Response {
  const { input, toolName } = options;
  const content = input === undefined
    ? [{ type: "text", text: "Here is some plain text." }]
    : [
        { type: "text", text: "Let me call the tool." },
        { type: "tool_use", id: "call_1", name: toolName, input },
      ];
  return okJson({
    content,
    usage: { input_tokens: 100, output_tokens: 25 },
  });
}

const TOOL = {
  name: "coach_result",
  description: "the structured verdict",
  input_schema: { type: "object", properties: {}, required: [] },
};

function structReq(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    prompt: "ignored when structured",
    model: "pinned-model",
    maxTokens: 200,
    structuredOutput: {
      system: "You review form, not content.",
      userMessage: "Question: The metric\n\nAnswer:\nReach goes up.",
      tool: TOOL,
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("structured-output (tool-use) mode", () => {
  it("sends system, a single user turn, the forced tool, and tool_choice", async () => {
    let sentBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponseFor({ input: { verdict: "needs_work" }, toolName: "coach_result" });
      }),
    );

    const provider = anthropicProvider("test-key");
    const res = await provider.request(structReq());

    expect(sentBody!.system).toBe("You review form, not content.");
    expect(sentBody!.messages).toEqual([
      { role: "user", content: "Question: The metric\n\nAnswer:\nReach goes up." },
    ]);
    expect(sentBody!.tools).toEqual([TOOL]);
    expect(sentBody!.tool_choice).toEqual({ type: "tool", name: "coach_result" });
    expect(sentBody!.model).toBe("pinned-model");
    expect(sentBody!.max_tokens).toBe(200);

    // The tool input comes back as `text` (the guard scans `ProviderResponse.text`).
    expect(res.text).toBe(JSON.stringify({ verdict: "needs_work" }));
    expect(res.model).toBe("pinned-model");
  });

  it("a plain-text call sends messages only, with no system or tools", async () => {
    let sentBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponseFor();
      }),
    );

    const provider = anthropicProvider("test-key");
    await provider.request({
      prompt: "Review this.",
      model: "pinned-model",
      maxTokens: 200,
    });

    expect(sentBody!.messages).toEqual([{ role: "user", content: "Review this." }]);
    expect(sentBody!.system).toBeUndefined();
    expect(sentBody!.tools).toBeUndefined();
    expect(sentBody!.tool_choice).toBeUndefined();
  });

  it("returns the tool_use input even when the model also wrote free text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponseFor({
          input: { verdict: "ok", dimension: null, hint: "", example: "" },
          toolName: "coach_result",
        }),
      ),
    );
    const provider = anthropicProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.text).toBe(
      JSON.stringify({ verdict: "ok", dimension: null, hint: "", example: "" }),
    );
  });

  it("a structured call that gets no tool_use back falls back to the text blocks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponseFor()),
    );
    const provider = anthropicProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.text).toBe("Here is some plain text.");
  });

  it("records the token counts from the response usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponseFor({ input: { verdict: "ok" }, toolName: "coach_result" })),
    );
    const provider = anthropicProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.inputTokens).toBe(100);
    expect(res.outputTokens).toBe(25);
  });

  it("a non-2xx response rejects with a typed ProviderHttpError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    const provider = anthropicProvider("test-key");
    await expect(provider.request(structReq())).rejects.toBeInstanceOf(
      ProviderHttpError,
    );
  });
});

// F18-T01 — the Gemini implementation behind the same `AIProvider` boundary.
// Same contract, different transport: `POST …:generateContent`, auth only in
// the `x-goog-api-key` header, mapping per M06 (systemInstruction/contents,
// generationConfig.maxOutputTokens, tools[].functionDeclarations with
// toolConfig mode ANY). These tests fake `global.fetch` and assert both the
// outbound body and the inbound extraction, mirroring the Anthropic suite.

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/pinned-model:generateContent";

/** A plausible Gemini `generateContent` body for the faked transport. */
function geminiResponseFor(options: {
  args?: unknown;
  text?: string;
  toolName?: string;
  promptTokens?: number;
  candidatesTokens?: number;
} = {}): Response {
  const {
    args,
    text = "Here is some plain text.",
    toolName,
    promptTokens = 100,
    candidatesTokens = 25,
  } = options;
  const parts =
    args === undefined
      ? [{ text }]
      : [
          { text: "Let me call the function." },
          { functionCall: { name: toolName, args } },
        ];
  return okJson({
    candidates: [{ content: { parts, role: "model" } }],
    usageMetadata: {
      promptTokenCount: promptTokens,
      candidatesTokenCount: candidatesTokens,
    },
  });
}

// The Gemini request carries the credential in the `x-goog-api-key` header and
// never in the URL — a fail in either direction breaks §8's "URLs reach logs
// and proxies". Checked on every faked call via this shared assertion.
function expectAuthInHeaderOnly(init: RequestInit): void {
  const headers = init.headers as Record<string, string>;
  expect(headers["x-goog-api-key"]).toBe("test-key");
  expect(headers["content-type"]).toBe("application/json");
}

describe("geminiProvider", () => {
  it("maps a plain call to contents/generationConfig and reads the text back", async () => {
    let sentBody: Record<string, unknown> | undefined;
    let sentUrl: string | undefined;
    let sentInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: RequestInit) => {
        sentUrl = String(url);
        sentInit = init;
        sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return geminiResponseFor();
      }),
    );

    const provider = geminiProvider("test-key");
    const res = await provider.request({
      prompt: "Review this.",
      model: "pinned-model",
      maxTokens: 200,
    });

    expect(sentUrl).toBe(GEMINI_ENDPOINT);
    expect(sentUrl).not.toContain("test-key");
    expectAuthInHeaderOnly(sentInit!);
    expect(sentBody!.contents).toEqual([
      { role: "user", parts: [{ text: "Review this." }] },
    ]);
    expect(sentBody!.generationConfig).toEqual({ maxOutputTokens: 200 });
    expect(sentBody!.systemInstruction).toBeUndefined();
    expect(sentBody!.tools).toBeUndefined();
    expect(sentBody!.toolConfig).toBeUndefined();
    expect(res.text).toBe("Here is some plain text.");
    expect(res.model).toBe("pinned-model");
  });

  it("maps a structured call to systemInstruction, a function declaration, and mode ANY", async () => {
    let sentBody: Record<string, unknown> | undefined;
    let sentUrl: string | undefined;
    let sentInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init: RequestInit) => {
        sentUrl = String(url);
        sentInit = init;
        sentBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return geminiResponseFor({
          args: { verdict: "needs_work" },
          toolName: "coach_result",
        });
      }),
    );

    const provider = geminiProvider("test-key");
    const res = await provider.request(structReq());

    expect(sentUrl).toBe(GEMINI_ENDPOINT);
    expect(sentUrl).not.toContain("test-key");
    expectAuthInHeaderOnly(sentInit!);
    expect(sentBody!.systemInstruction).toEqual({
      parts: [{ text: "You review form, not content." }],
    });
    expect(sentBody!.contents).toEqual([
      {
        role: "user",
        parts: [{ text: "Question: The metric\n\nAnswer:\nReach goes up." }],
      },
    ]);
    expect(sentBody!.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "coach_result",
            description: "the structured verdict",
            parameters: { type: "object", properties: {}, required: [] },
          },
        ],
      },
    ]);
    expect(sentBody!.toolConfig).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
    // The function args come back as `text` (the guard scans `ProviderResponse.text`).
    expect(res.text).toBe(JSON.stringify({ verdict: "needs_work" }));
  });

  it("returns the function args even when the model also wrote free text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponseFor({
          args: { verdict: "ok", dimension: null, hint: "", example: "" },
          toolName: "coach_result",
        }),
      ),
    );
    const provider = geminiProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.text).toBe(
      JSON.stringify({ verdict: "ok", dimension: null, hint: "", example: "" }),
    );
  });

  it("a structured call with no function call falls back to the text parts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => geminiResponseFor()));
    const provider = geminiProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.text).toBe("Here is some plain text.");
  });

  it("records the token counts from usageMetadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponseFor({ args: { verdict: "ok" }, toolName: "coach_result" }),
      ),
    );
    const provider = geminiProvider("test-key");
    const res = await provider.request(structReq());
    expect(res.inputTokens).toBe(100);
    expect(res.outputTokens).toBe(25);
  });

  it.each([429, 503, 500])(
    "a %d response rejects with a typed ProviderHttpError carrying the status",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("not ok", { status })),
      );
      const provider = geminiProvider("test-key");
      await expect(provider.request(structReq())).rejects.toBeInstanceOf(
        ProviderHttpError,
      );
      await expect(provider.request(structReq())).rejects.toMatchObject({
        status,
      });
    },
  );

  it("a network failure rejects so the gateway degrades", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(structReq())).rejects.toThrow();
  });

  it("a 200 with an empty body is handled gracefully as empty text and zero tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    const provider = geminiProvider("test-key");
    const res = await provider.request({
      prompt: "Review this.",
      model: "pinned-model",
      maxTokens: 200,
    });
    expect(res.text).toBe("");
    expect(res.inputTokens).toBe(0);
    expect(res.outputTokens).toBe(0);
  });

  it("a 200 with an unparseable body rejects so the gateway degrades", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 200 })),
    );
    const provider = geminiProvider("test-key");
    await expect(
      provider.request({ prompt: "x", model: "pinned-model", maxTokens: 200 }),
    ).rejects.toThrow();
  });
});

// F18-T02 — schema fidelity. Gemini's function declarations take an
// OpenAPI-3.0-subset schema, and a forced tool call does not guarantee that the
// *arguments* it returns satisfy that schema. These tests prove the provider
// validates the complete argument shape against the declared input_schema
// before serialising it for the output guard: a partial or off-shape reply
// rejects as a provider failure (degrading the gateway) instead of letting a
// malformed object reach the guard or a browser. They run against the production
// coach tool schema (COACH_RESULT_TOOL), so the enum/required constraints proven
// here are exactly the ones the API must enforce on the wire.

/** A structured request carrying the real coach schema (not a stub). */
function coachStructuredReq(): ProviderRequest {
  return {
    prompt: "ignored when structured",
    model: "pinned-model",
    maxTokens: 200,
    structuredOutput: {
      system: "You review form, not content.",
      userMessage: "Question: The metric\n\nAnswer:\nReach goes up.",
      tool: COACH_RESULT_TOOL,
    },
  };
}

function replyWithArgs(args: unknown): Response {
  return geminiResponseFor({ args, toolName: "coach_result" });
}

describe("geminiProvider schema fidelity (F18-T02)", () => {
  it("serialises a fully-conforming coach_result to text for the guard", async () => {
    const args = { verdict: "ok", dimension: null, hint: "", example: "" };
    vi.stubGlobal("fetch", vi.fn(async () => replyWithArgs(args)));
    const provider = geminiProvider("test-key");
    const res = await provider.request(coachStructuredReq());
    expect(res.text).toBe(JSON.stringify(args));
  });

  it("a non-conforming reply — an out-of-enum verdict — rejects as a provider failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        replyWithArgs({ verdict: "great", dimension: null, hint: "", example: "" }),
      ),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(coachStructuredReq())).rejects.toBeInstanceOf(
      ProviderShapeError,
    );
  });

  it("a partial reply missing a required field rejects before the guard", async () => {
    // Dropping `example`, one of the four required fields, so the model's forced
    // call returned only part of the §5.3 shape.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        replyWithArgs({ verdict: "needs_work", dimension: "too_short", hint: "Too short." }),
      ),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(coachStructuredReq())).rejects.toBeInstanceOf(
      ProviderShapeError,
    );
  });

  it("a dimension outside the four configured dimensions rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        replyWithArgs({ verdict: "needs_work", dimension: "length", hint: "x", example: "" }),
      ),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(coachStructuredReq())).rejects.toBeInstanceOf(
      ProviderShapeError,
    );
  });

  it("the serialised conforming shape parses back to the §5.3 CoachOutput the Anthropic path produced", async () => {
    const args = {
      verdict: "needs_work",
      dimension: "measurability",
      hint: "What would you point at to show this happened?",
      example: "",
    };
    vi.stubGlobal("fetch", vi.fn(async () => replyWithArgs(args)));
    const provider = geminiProvider("test-key");
    const res = await provider.request(coachStructuredReq());
    // The provider serialises exactly the validated arguments, so whatever the
    // Anthropic implementation returned for the same tool input, this is the
    // same shape the coach parser must accept.
    expect(JSON.parse(res.text)).toEqual(args);
  });
});

// F18-T03 (M08) — safety-block handling. Gemini can refuse a turn with a 200
// and no usable content: a candidate with `finishReason: "SAFETY"`, or a
// prompt blocked via `promptFeedback.blockReason`. Both must reject as a typed
// `ProviderSafetyError` so the gateway degrades to the deterministic sibling
// and records the block distinctly. The reason is carried on the error so it
// lands in `ai_interactions.blocked_reason`; it is never an HTTP error, so the
// gateway's 429/503 retry policy ignores it (a block does not clear on re-send).

/** A SAFETY-finished candidate, the common blocked-turn shape. */
function safetyResponse(): Response {
  return okJson({
    candidates: [
      { finishReason: "SAFETY", index: 0 },
    ],
  });
}

describe("geminiProvider safety blocks (F18-T03)", () => {
  it("a candidate with finishReason SAFETY rejects with ProviderSafetyError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => safetyResponse()));
    const provider = geminiProvider("test-key");
    await expect(provider.request(structReq())).rejects.toBeInstanceOf(
      ProviderSafetyError,
    );
  });

  it("carries the block reason so it lands in ai_interactions.blocked_reason", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => safetyResponse()));
    const provider = geminiProvider("test-key");
    await expect(provider.request(structReq())).rejects.toMatchObject({
      name: "ProviderSafetyError",
      reason: "SAFETY",
    });
  });

  it("a prompt block via promptFeedback.blockReason rejects too, with that reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({ promptFeedback: { blockReason: "DANGEROUS_CONTENT" } }),
      ),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(structReq())).rejects.toMatchObject({
      reason: "DANGEROUS_CONTENT",
    });
  });

  it("a SAFETY block on a structured coach call rejects before any shape parsing", async () => {
    // The forced-tool path must degrade just the same: a block is a provider
    // failure, not a malformed-coach-reply, and must not be mis-handled as an
    // empty-then-parse-fallback (which would not record the block distinctly).
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okJson({
          candidates: [{ finishReason: "SAFETY", index: 0 }],
          usageMetadata: { promptTokenCount: 33, candidatesTokenCount: 0 },
        }),
      ),
    );
    const provider = geminiProvider("test-key");
    await expect(provider.request(coachStructuredReq())).rejects.toBeInstanceOf(
      ProviderSafetyError,
    );
  });

  it("a 200 with no candidate and no promptFeedback is not a block — empty text", async () => {
    // The existing empty-body behaviour is untouched: only an explicit SAFETY
    // finish reason or a blockReason marks a provider-safety failure.
    vi.stubGlobal("fetch", vi.fn(async () => okJson({})));
    const provider = geminiProvider("test-key");
    const res = await provider.request({
      prompt: "Review this.",
      model: "pinned-model",
      maxTokens: 200,
    });
    expect(res.text).toBe("");
  });
});