import { NextResponse } from "next/server";
import {
  fetchEventDefinitions,
  fetchPropertyDefinitions,
  sampleEventUrls,
  sampleTransactions,
} from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import { ANALYZE_SYSTEM_PROMPT } from "@/lib/system-prompts";
import type { LLMProvider, DashboardType, SpecificInsight, KPIPlan } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  dashboardTypes: DashboardType[];
  otherDescription: string;
  objective: string;
  agentRecommendations: string;
  specificInsights: SpecificInsight[];
  feedback?: string;
  previousPlan?: KPIPlan;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    // Step 1: Fetch all PostHog data in parallel
    const [events, eventProps, personProps, urls, transactions] = await Promise.all([
      fetchEventDefinitions(body.posthogApiKey, body.projectId, body.posthogHost),
      fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "event"),
      fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "person"),
      sampleEventUrls(body.posthogApiKey, body.projectId, body.posthogHost),
      sampleTransactions(body.posthogApiKey, body.projectId, body.posthogHost),
    ]);

    // Step 2: Build the user prompt with all context
    const eventsSummary = events
      .sort((a, b) => (b.volume_30_day ?? 0) - (a.volume_30_day ?? 0))
      .slice(0, 200) // Top 200 by volume
      .map((e) => `- ${e.name} (30d volume: ${e.volume_30_day ?? "unknown"})`)
      .join("\n");

    const eventPropsSummary = eventProps
      .slice(0, 100)
      .map((p) => `- ${p.name} (type: ${p.property_type ?? "unknown"})`)
      .join("\n");

    const personPropsSummary = personProps
      .slice(0, 50)
      .map((p) => `- ${p.name} (type: ${p.property_type ?? "unknown"})`)
      .join("\n");

    const urlsSummary = urls.slice(0, 50).map((u) => `- ${u}`).join("\n");

    const txSummary = transactions
      .map((t) => `- ${t.event} (count: ${t.count})`)
      .join("\n");

    const insightsSummary = body.specificInsights.length > 0
      ? body.specificInsights.map((i, idx) =>
          `${idx + 1}. ${i.description} [Type: ${i.insightType}${i.trendGranularity ? `, Granularity: ${i.trendGranularity}` : ""}]${i.instructions ? ` — Instructions: ${i.instructions}` : ""}`
        ).join("\n")
      : "None provided";

    const feedbackSection = body.feedback
      ? `\n\n--- USER FEEDBACK ON PREVIOUS PLAN ---\n${body.feedback}\n\nPlease revise the plan based on this feedback.\n`
      : "";

    const userPrompt = `## Project: ${body.projectName} (ID: ${body.projectId})

## Dashboard Types Requested: ${body.dashboardTypes.join(", ")}
${body.dashboardTypes.includes("other") ? `Custom description: ${body.otherDescription}` : ""}

## Objective
${body.objective}

## Agent Recommendations
${body.agentRecommendations || "None provided"}

## Events (top 200 by 30-day volume)
${eventsSummary}

## Event Properties (top 100)
${eventPropsSummary}

## Person Properties (top 50)
${personPropsSummary}

## Sample Pageview URLs (last 30 days)
${urlsSummary}

## Transaction/Payment Events
${txSummary || "No payment-related events found"}

## Specific Insights Requested
${insightsSummary}
${feedbackSection}

Now analyze this data and return the KPI plan as JSON.`;

    // Step 3: Call LLM
    const llmResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: ANALYZE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      true,
    );

    // Step 4: Parse and return
    let plan: KPIPlan;
    try {
      // Try to extract JSON from the response
      let jsonStr = llmResponse.trim();
      // Remove markdown fences if present
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      plan = JSON.parse(jsonStr) as KPIPlan;
    } catch {
      // If parsing fails, try to extract JSON from response
      const match = llmResponse.match(/\{[\s\S]*\}/);
      if (match) {
        plan = JSON.parse(match[0]) as KPIPlan;
      } else {
        throw new Error("Failed to parse LLM response as JSON");
      }
    }

    // Ensure each KPI has an id
    plan.kpis = plan.kpis.map((kpi, i) => ({
      ...kpi,
      id: kpi.id || `kpi-${i}`,
      feedbackStatus: "pending" as const,
      feedback: "",
    }));

    return NextResponse.json({
      plan,
      meta: {
        eventsCount: events.length,
        eventPropsCount: eventProps.length,
        personPropsCount: personProps.length,
        urlsCount: urls.length,
        transactionsCount: transactions.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
