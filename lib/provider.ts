// The provider boundary (F12-T01, tech_infrastructure.md §2). This is the only
// file that talks to a model vendor. The gateway in lib/ai-gateway.ts depends
// on the `AIProvider` interface here, and a scan test forbids any module but
// the gateway from importing this file — that is the concrete form of "the
// system SHALL NOT permit any other module to call the provider SDK directly".
//
// No answer text and no respondent identity are accepted or returned: the
// caller hands the provider a self-contained prompt, and it returns raw text
// plus token counts. The shape is deliberately vendor-neutral so a different
// model backend slots in behind the same boundary without touching the gateway.
//
// Server-side only by construction: the concrete client reads the API key that
// the gateway passes in, never anything a client bundle could reach.

import { validateStructuredShape } from "./structured-shape";

/** Hard per-request timeout for a provider call (tech_infrastructure.md §6.2). */
export const PROVIDER_TIMEOUT_MS = 6000;

/**
 * A provider call that reached the vendor and got a non-2xx HTTP status. The
 * gateway's retry policy (F12-T05, §6.2) keys on this shape: only a real 429 or
 * 503 is retried, once, with jittered backoff. Carrying the status as a typed
 * field instead of a scraped string is what lets the gateway tell a retriable
 * "rate limited / service unavailable" apart from a permanent 4xx or a 5xx it
 * should not burn a retry on.
 */
export class ProviderHttpError extends Error {
  constructor(readonly status: number) {
    super(`provider responded ${status}`);
    this.name = "ProviderHttpError";
  }
}

/**
 * A structured function call whose arguments did not match the declared
 * `input_schema` (F18-T02, M07). The model was forced to call the tool but the
 * arguments came back off-shape — a missing required field, an out-of-enum
 * value, a wrong type — so there is no structural guarantee left. It is not an
 * HTTP error (so the gateway will not burn a retry on it) and the gateway
 * degrades the call the same way it would any other provider failure, keeping
 * the malformed object away from the output guard and the browser.
 */
export class ProviderShapeError extends Error {
  constructor(readonly violations: string[]) {
    super(
      `structured output did not conform to the declared schema: ${violations.join("; ")}`,
    );
    this.name = "ProviderShapeError";
  }
}

/**
 * A structured-output directive (F13-T01, tech_infrastructure.md §5.3). When
 * present, the provider sends the request in tool-use mode — a `system` prompt,
 * a single user turn, and the one tool the model is forced to call — so the
 * response is structurally constrained by the API rather than by a politely
 * worded prompt. This is how the coach guarantees its `{verdict, dimension,
 * hint, example}` shape: free-text replies are impossible, not merely unlikely.
 */
export interface StructuredOutputDirective {
  /** The `system` prompt that states the constraints (coach §5.2). */
  system: string;
  /** The user turn: question metadata + the single answer under evaluation. */
  userMessage: string;
  /** The one tool the model is forced to fill (`coach_result` for the coach). */
  tool: { name: string; description?: string; input_schema: object };
}

/** Everything the gateway's request stage hands a provider. */
export interface ProviderRequest {
  /** The full prompt for a plain-text call; ignored when `structuredOutput` is set. */
  prompt: string;
  /** Model id, pinned by config; recorded so a change is auditable (§10). */
  model: string;
  /** Hard cap on the model output in tokens (§6.2 per-request caps). */
  maxTokens: number;
  /** When set, the call is sent in tool-use mode and must fill this tool. */
  structuredOutput?: StructuredOutputDirective;
}

/** A completed provider call, before the output guard sees it. */
export interface ProviderResponse {
  /** Raw text returned by the model. */
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

/** The boundary the gateway calls; faked in unit tests. */
export interface AIProvider {
  request(req: ProviderRequest): Promise<ProviderResponse>;
}

/**
 * The Anthropic client behind that boundary — a Messages API call made with
 * `fetch`, so no SDK dependency is needed (tech_infrastructure.md §1 names
 * dependencies deliberately; none of them is an HTTP client). A non-2xx
 * response and a network failure both reject, and the gateway turns either
 * into a lower-level response (spec.md §7, PR3).
 */
export function anthropicProvider(apiKey: string): AIProvider {
  return {
    async request(req) {
      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens,
      };
      if (req.structuredOutput !== undefined) {
        // Tool-use mode: system prompt, one user turn, and the forced tool. The
        // model cannot answer in free text here — it must fill the tool input.
        body.system = req.structuredOutput.system;
        body.messages = [
          { role: "user", content: req.structuredOutput.userMessage },
        ];
        body.tools = [req.structuredOutput.tool];
        body.tool_choice = {
          type: "tool",
          name: req.structuredOutput.tool.name,
        };
      } else {
        body.messages = [{ role: "user", content: req.prompt }];
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        throw new ProviderHttpError(res.status);
      }
      const parsed = (await res.json()) as {
        content?: Array<{
          type?: string;
          text?: string;
          name?: string;
          input?: unknown;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const blocks = parsed.content ?? [];
      const textBlocks = blocks.map((c) => c.text ?? "").join("");
      // The serialised structured output travels back as `text` so the output
      // guard (which scans `ProviderResponse.text`) sees it, and so a calling
      // F13 endpoint can run it back through the coach parser.
      const structured = blocks.find(
        (c) =>
          c.type === "tool_use" &&
          c.name === req.structuredOutput?.tool.name,
      )?.input;
      return {
        text:
          structured !== undefined ? JSON.stringify(structured) : textBlocks,
        inputTokens: parsed.usage?.input_tokens ?? 0,
        outputTokens: parsed.usage?.output_tokens ?? 0,
        model: req.model,
      };
    },
  };
}

/**
 * The Gemini client behind the `AIProvider` boundary (F18-T01, source item
 * M06) — a `generateContent` call made with `fetch`, so no SDK dependency is
 * added (tech_infrastructure.md §1 names dependencies deliberately). Request
 * mapping per M06: the system prompt and user turn go into
 * `systemInstruction`/`contents`, the output cap into `generationConfig`, and
 * forced structure uses `tools[].functionDeclarations` with
 * `toolConfig.functionCallingConfig.mode = "ANY"`. The structured result is
 * the matched `functionCall.args`, serialised to `ProviderResponse.text` as
 * JSON exactly like the Anthropic path, so the output guard sees it unchanged.
 *
 * The credential travels only in the `x-goog-api-key` header and never in the
 * URL, because URLs reach logs and proxies (spec.md §8). A non-2xx rejects
 * with a typed `ProviderHttpError`, so the gateway's 429/503 retry policy
 * (F12-T05) keeps working; a network failure or unparseable body rejects too,
 * and the gateway turns every rejection into a valid lower-level response.
 */
export function geminiProvider(apiKey: string): AIProvider {
  return {
    async request(req) {
      const body: Record<string, unknown> = {
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: { maxOutputTokens: req.maxTokens },
      };
      if (req.structuredOutput !== undefined) {
        // Tool-use / function-calling mode: system prompt via
        // systemInstruction, the single user turn, and the one function the
        // model is forced to call (mode "ANY"). Gemini's function declarations
        // take an OpenAPI-3.0-subset schema, which is the `parameters` field —
        // the coach's `input_schema` is carried over unchanged (F18-T02 keeps
        // the dialect in the subset Gemini accepts).
        body.systemInstruction = {
          parts: [{ text: req.structuredOutput.system }],
        };
        body.contents = [
          { role: "user", parts: [{ text: req.structuredOutput.userMessage }] },
        ];
        body.tools = [
          {
            functionDeclarations: [
              {
                name: req.structuredOutput.tool.name,
                description: req.structuredOutput.tool.description,
                parameters: req.structuredOutput.tool.input_schema,
              },
            ],
          },
        ];
        body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      }

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        throw new ProviderHttpError(res.status);
      }
      const parsed = (await res.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{
              text?: string;
              functionCall?: { name?: string; args?: unknown };
            }>;
          };
        }>;
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      };
      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      const textParts = parts.map((p) => p.text ?? "").join("");
      // The serialised structured output travels back as `text` so the output
      // guard (which scans `ProviderResponse.text`) sees it, and so a calling
      // F13 endpoint can run it back through the coach parser.
      const directive = req.structuredOutput;
      const structured = parts.find(
        (p) =>
          p.functionCall !== undefined &&
          p.functionCall.name === directive?.tool.name,
      )?.functionCall?.args;
      if (structured !== undefined && directive !== undefined) {
        // F18-T02 — validate the complete argument shape against the declared
        // input_schema before the guard sees anything. A forced tool call does
        // not guarantee conforming arguments; if they are partial or off-shape
        // this rejects with a provider failure so the gateway degrades and no
        // malformed object ever reaches the output guard or a browser. The
        // schema dialect in coach-prompt.ts is the OpenAPI subset Gemini
        // accepts, so every constraint declared here is one Gemini enforces.
        const violations = validateStructuredShape(
          directive.tool.input_schema,
          structured,
        );
        if (violations.length > 0) {
          throw new ProviderShapeError(violations);
        }
      }
      return {
        text: structured !== undefined ? JSON.stringify(structured) : textParts,
        inputTokens: parsed.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount ?? 0,
        model: req.model,
      };
    },
  };
}