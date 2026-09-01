import { NextResponse } from "next/server";
import {
  CELL_REGISTRY_MAP,
  getSurveyAnswersForCell,
} from "@/lib/opsp-seed";
import {
  IDEATE_SYSTEM_PROMPT,
  IDEATE_TOOL_SCHEMA,
  formatIdeateUserMessage,
  staticCellIdeation,
  type CellIdeationResult,
} from "@/lib/opsp-ideate-prompt";
import {
  callProvider,
  geminiProvider,
  type GatewayContext,
  type ProviderRequest,
} from "@/lib/ai-gateway";
import { aiApiKey, loadConfig } from "@/lib/config";

export async function POST(request: Request) {
  let body: { cellId?: string; currentContent?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const { cellId, currentContent } = body;
  if (!cellId || !CELL_REGISTRY_MAP[cellId]) {
    return NextResponse.json({ ok: false, error: "invalid cellId" }, { status: 400 });
  }

  const cellDef = CELL_REGISTRY_MAP[cellId];
  const surveyAnswers = getSurveyAnswersForCell(cellId);

  const config = loadConfig();
  const apiKey = aiApiKey();
  const model = process.env.AI_MODEL || "gemini-3.7-flash";

  // If no API key or forced L2/L3, return static ideation directly
  if (!apiKey || config.aiLevel === "L2" || config.aiLevel === "L3") {
    const staticResult = staticCellIdeation(cellDef, surveyAnswers);
    return NextResponse.json({
      ok: true,
      level: "L2",
      ideation: staticResult,
    });
  }

  const provider = geminiProvider(apiKey);
  const userMessage = formatIdeateUserMessage(cellDef, currentContent, surveyAnswers);

  const providerReq: ProviderRequest = {
    prompt: userMessage,
    model,
    maxTokens: 800,
    structuredOutput: {
      system: IDEATE_SYSTEM_PROMPT,
      userMessage,
      tool: IDEATE_TOOL_SCHEMA,
    },
  };

  const gatewayCtx: GatewayContext = {
    purpose: "analysis",
    pin: config.aiLevelPin === "L0" || config.aiLevelPin === "L1" || config.aiLevelPin === "L2"
      ? config.aiLevelPin
      : "auto",
    budgetExhausted: false,
    circuitOpen: false,
    latencyDegraded: false,
  };

  const result = await callProvider(gatewayCtx, provider, providerReq);

  if (result.degraded || !result.provider?.text) {
    const fallback = staticCellIdeation(cellDef, surveyAnswers);
    return NextResponse.json({
      ok: true,
      level: result.level,
      ideation: fallback,
    });
  }

  try {
    const parsed = JSON.parse(result.provider.text) as CellIdeationResult;
    if (
      typeof parsed.summary === "string" &&
      Array.isArray(parsed.themes) &&
      Array.isArray(parsed.tensions) &&
      Array.isArray(parsed.suggestions)
    ) {
      return NextResponse.json({
        ok: true,
        level: result.level,
        ideation: parsed,
      });
    }
  } catch {}

  const fallback = staticCellIdeation(cellDef, surveyAnswers);
  return NextResponse.json({
    ok: true,
    level: "L2",
    ideation: fallback,
  });
}
