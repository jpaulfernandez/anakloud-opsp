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

/** Hard per-request timeout for a provider call (tech_infrastructure.md §6.2). */
export const PROVIDER_TIMEOUT_MS = 6000;

/** Everything the gateway's request stage hands a provider. */
export interface ProviderRequest {
  /** The full prompt, already assembled by the caller (F13/F14). */
  prompt: string;
  /** Model id, pinned by config; recorded so a change is auditable (§10). */
  model: string;
  /** Hard cap on the model output in tokens (§6.2 per-request caps). */
  maxTokens: number;
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
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens,
          messages: [{ role: "user", content: req.prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`provider responded ${res.status}`);
      }
      const body = (await res.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        text: (body.content ?? []).map((c) => c.text ?? "").join(""),
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
        model: req.model,
      };
    },
  };
}