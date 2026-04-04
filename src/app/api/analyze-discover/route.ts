import { NextResponse } from "next/server";
import {
  fetchEventDefinitions,
  fetchPropertyDefinitions,
  sampleEventUrls,
  sampleTransactions,
  fetchExistingDashboards,
  fetchExistingInsights,
  sampleRecentEventData,
} from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import { AGENT_1_DISCOVERY_PROMPT } from "@/lib/system-prompts";
import type { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
};

export async function POST(request: Request) {
  try {
    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Fetch all PostHog data in parallel
    const [events, eventProps, personProps, urls, transactions, existingDashboards, existingInsights, sampleData] =
      await Promise.all([
        fetchEventDefinitions(body.posthogApiKey, body.projectId, body.posthogHost),
        fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "event"),
        fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "person"),
        sampleEventUrls(body.posthogApiKey, body.projectId, body.posthogHost),
        sampleTransactions(body.posthogApiKey, body.projectId, body.posthogHost),
        fetchExistingDashboards(body.posthogApiKey, body.projectId, body.posthogHost),
        fetchExistingInsights(body.posthogApiKey, body.projectId, body.posthogHost),
        sampleRecentEventData(body.posthogApiKey, body.projectId, body.posthogHost),
      ]);

    // Build compact summaries (keep under token limits for fast responses)
    const eventsSummary = events
      .sort((a, b) => (b.volume_30_day ?? 0) - (a.volume_30_day ?? 0))
      .slice(0, 150)
      .map((e) => `${e.name} (${e.volume_30_day ?? "?"})`)
      .join("\n");

    const propsSummary = eventProps.slice(0, 60).map((p) => `${p.name}:${p.property_type ?? "?"}`).join(", ");
    const personSummary = personProps.slice(0, 30).map((p) => `${p.name}:${p.property_type ?? "?"}`).join(", ");
    const urlsSummary = urls.slice(0, 30).join("\n");
    const txSummary = transactions.map((t) => `${t.event}(${t.count})`).join(", ");

    const dashSummary = existingDashboards.slice(0, 15).map((d) => {
      const tiles = d.tiles.slice(0, 5).map((t) => t.name).join(", ");
      return `"${d.name}": ${tiles}`;
    }).join("\n");

    const insightSummary = existingInsights.slice(0, 30).map((i) => i.name).join(", ");
    const sampleSummary = sampleData.slice(0, 15).map((s) => `${s.event}: ${String(s.properties).slice(0, 120)}`).join("\n");

    const prompt = `## Project: ${body.projectName} (ID: ${body.projectId})

## Events (top 150 by volume)
${eventsSummary}

## Event Properties: ${propsSummary}
## Person Properties: ${personSummary}

## URLs (sample)
${urlsSummary}

## Transaction Events: ${txSummary || "None"}

## Existing Dashboards
${dashSummary || "None"}

## Existing Insights: ${insightSummary || "None"}

## Sample Data (7d)
${sampleSummary || "None"}

Return the structured project context JSON.`;

    const discoveryContext = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: AGENT_1_DISCOVERY_PROMPT },
        { role: "user", content: prompt },
      ],
      true,
    );

    return NextResponse.json({
      discoveryContext,
      meta: {
        eventsCount: events.length,
        eventPropsCount: eventProps.length,
        personPropsCount: personProps.length,
        urlsCount: urls.length,
        transactionsCount: transactions.length,
        dashboardsCount: existingDashboards.length,
        insightsCount: existingInsights.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Discovery failed";
    console.error("[analyze-discover] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
