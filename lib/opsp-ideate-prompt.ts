import {
  type CellDef,
  type SurveyAnswer,
} from "./opsp-seed";

export interface CellIdeationResult {
  summary: string;
  themes: string[];
  tensions: string[];
  suggestions: string[];
}

export const IDEATE_SYSTEM_PROMPT = `You are a senior executive coach and Scaling Up strategic advisor assisting a founding team of six in synthesizing their One-Page Strategic Plan (OPSP).
You are analyzing the team's private survey answers for a specific strategic cell.

Your job is to provide non-judgmental IDEATION and ANNOTATIONS only:
1. Identify underlying common themes and points of consensus across team members.
2. Highlight honest tensions, divergent perspectives, or trade-offs between different viewpoints.
3. Offer 2-3 crisp, concrete wording options or draft suggestions for this specific cell inspired by their answers.

CRITICAL RULES:
- Frame your output as thought-provoking annotations and suggestions, NOT a mandated choice.
- Do not invent external data. Ground all synthesis directly in the team's provided survey answers.
- Keep language concise, sharp, and business-focused.`;

export function formatIdeateUserMessage(
  cellDef: CellDef,
  currentContent: unknown,
  surveyAnswers: SurveyAnswer[],
): string {
  const answersBlock =
    surveyAnswers.length > 0
      ? surveyAnswers
          .map((a) => {
            const conf = a.confidence ? ` (Confidence: ${a.confidence}/5)` : "";
            const meta = a.meta ? ` [Meta: ${JSON.stringify(a.meta)}]` : "";
            return `- ${a.person}${conf}: "${a.answer}"${meta}`;
          })
          .join("\n")
      : "(No direct survey answers available for this cell)";

  return `Cell: ${cellDef.id} — ${cellDef.label} (${cellDef.column.toUpperCase()})
Cell Kind: ${cellDef.kind}
Description / Helper: ${cellDef.helper ?? "None"}
Current Draft Value: ${JSON.stringify(currentContent)}

Team Survey Answers:
${answersBlock}

Analyze the team inputs and provide synthesis annotations.`;
}

export const IDEATE_TOOL_SCHEMA = {
  name: "cell_ideation_result",
  description: "Structured strategic ideation annotations for an OPSP cell",
  input_schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "1-2 sentence high-level synthesis of the team's positions",
      },
      themes: {
        type: "array",
        items: { type: "string" },
        description: "2-3 key themes or consensus points from the answers",
      },
      tensions: {
        type: "array",
        items: { type: "string" },
        description: "1-2 strategic tensions or trade-offs between different positions",
      },
      suggestions: {
        type: "array",
        items: { type: "string" },
        description: "2-3 concrete draft suggestions for this cell",
      },
    },
    required: ["summary", "themes", "tensions", "suggestions"],
  },
};

/**
 * Deterministic fallback ideation when AI is offline / degraded (L2).
 */
export function staticCellIdeation(
  cellDef: CellDef,
  surveyAnswers: SurveyAnswer[],
): CellIdeationResult {
  if (surveyAnswers.length === 0) {
    return {
      summary: `This cell (${cellDef.label}) is not fed directly by baseline survey answers. Complete it through live group discussion.`,
      themes: ["Open discussion item for the leadership team"],
      tensions: ["Requires alignment on strategic priority for this cycle"],
      suggestions: [
        `Draft a concise target for ${cellDef.label}`,
        `Benchmark against quarterly operational capacity`,
      ],
    };
  }

  const names = surveyAnswers.map((a) => a.person);
  const sampleAnswers = surveyAnswers.slice(0, 3).map((a) => `"${a.answer}"`);

  return {
    summary: `Found ${surveyAnswers.length} responses from ${names.join(", ")}. Strong thematic overlap on core purpose with nuances in focus.`,
    themes: [
      `Shared recognition of clinical workflow impact and patient care delivery`,
      `Emphasis on practical adoption and stakeholder trust across centers`,
    ],
    tensions: [
      `Balance between healthcare mission focus and B2B SaaS commercial scaling`,
    ],
    suggestions: sampleAnswers.length > 0 ? sampleAnswers : [
      `Focus on primary customer benefit with verifiable metrics`,
      `Adopt concise 1-sentence formulation agreed upon by the team`,
    ],
  };
}
