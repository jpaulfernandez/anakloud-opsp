import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anthropicProvider,
  ProviderHttpError,
  type ProviderRequest,
} from "../../lib/provider";

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