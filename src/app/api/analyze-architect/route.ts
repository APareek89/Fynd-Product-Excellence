import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm-client";
import { AGENT_2_ARCHITECT_PROMPT } from "@/lib/system-prompts";
import type { LLMProvider, DashboardType, SpecificInsight, KPIPlan } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  llmProvider: LLMProvider;
  llmApiKey: string;
  discoveryContext: string;
  dashboardTypes: DashboardType[];
  otherDescription: string;
  objective: string;
  agentRecommendations: string;
  specificInsights: SpecificInsight[];
  feedback?: string;
};

function extractJson(raw: string): string {
  let s = raw.trim();
  const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) s = fenceMatch[1].trim();
  if (s.startsWith("{")) return s;
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return s;
}

export async function POST(request: Request) {
  try {
    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const insightsSummary = body.specificInsights.length > 0
      ? body.specificInsights.map((i, idx) =>
          `${idx + 1}. ${i.description} [Type: ${i.insightType}${i.trendGranularity ? `, ${i.trendGranularity}` : ""}]${i.instructions ? ` — ${i.instructions}` : ""}`
        ).join("\n")
      : "None";

    const feedbackSection = body.feedback
      ? `\n\n--- FEEDBACK ---\n${body.feedback}\nRevise the plan based on this feedback.\n`
      : "";

    const prompt = `## Discovery Context (from Agent 1)
${body.discoveryContext}

## Objective
${body.objective}

## Agent Recommendations
${body.agentRecommendations || "None"}

## Dashboard Types: ${body.dashboardTypes.join(", ")}
${body.dashboardTypes.includes("other") ? `Custom: ${body.otherDescription}` : ""}

## Specific Insights
${insightsSummary}
${feedbackSection}

Return the KPI plan as JSON.`;

    const architectRaw = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: AGENT_2_ARCHITECT_PROMPT },
        { role: "user", content: prompt },
      ],
      true,
    );

    let plan: KPIPlan;
    try {
      plan = JSON.parse(extractJson(architectRaw)) as KPIPlan;
    } catch {
      throw new Error(`Failed to parse KPI plan. Raw: ${architectRaw.slice(0, 300)}`);
    }

    plan.kpis = plan.kpis.map((kpi, i) => ({
      ...kpi,
      id: kpi.id || `kpi-${i}`,
      feedbackStatus: "pending" as const,
      feedback: "",
    }));

    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Architect failed";
    console.error("[analyze-architect] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
