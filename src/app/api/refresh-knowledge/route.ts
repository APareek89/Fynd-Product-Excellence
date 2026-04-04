import { NextResponse } from "next/server";
import {
  fetchEventDefinitions,
  fetchPropertyDefinitions,
  sampleEventUrls,
  sampleTransactions,
  fetchExistingDashboards,
  fetchExistingInsights,
  runHogQL,
} from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import type { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  existingKnowledge?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    // Fetch fresh data focused on last 3 days
    const [
      events,
      eventProps,
      personProps,
      recentUrls,
      transactions,
      dashboards,
      insights,
      recentNewEvents,
      recentAppNames,
      recentSlugs,
    ] = await Promise.all([
      fetchEventDefinitions(body.posthogApiKey, body.projectId, body.posthogHost),
      fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "event"),
      fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "person"),
      sampleEventUrls(body.posthogApiKey, body.projectId, body.posthogHost),
      sampleTransactions(body.posthogApiKey, body.projectId, body.posthogHost),
      fetchExistingDashboards(body.posthogApiKey, body.projectId, body.posthogHost),
      fetchExistingInsights(body.posthogApiKey, body.projectId, body.posthogHost),
      // New events in last 3 days
      runHogQL<{ event: string; cnt: number; first_seen: string }>(
        body.posthogApiKey,
        body.projectId,
        `SELECT event, count() as cnt, min(timestamp) as first_seen
         FROM events
         WHERE timestamp > now() - INTERVAL 3 DAY
         GROUP BY event
         ORDER BY cnt DESC
         LIMIT 200`,
        body.posthogHost,
      ).catch(() => []),
      // Distinct app_name values in last 3 days
      runHogQL<{ app_name: string; cnt: number }>(
        body.posthogApiKey,
        body.projectId,
        `SELECT properties.app_name as app_name, count() as cnt
         FROM events
         WHERE timestamp > now() - INTERVAL 3 DAY
           AND properties.app_name IS NOT NULL
           AND properties.app_name != ''
         GROUP BY app_name
         ORDER BY cnt DESC
         LIMIT 50`,
        body.posthogHost,
      ).catch(() => []),
      // Distinct slugs / URLs in last 3 days
      runHogQL<{ url: string; cnt: number }>(
        body.posthogApiKey,
        body.projectId,
        `SELECT properties.$current_url as url, count() as cnt
         FROM events
         WHERE timestamp > now() - INTERVAL 3 DAY
           AND event = '$pageview'
           AND properties.$current_url IS NOT NULL
         GROUP BY url
         ORDER BY cnt DESC
         LIMIT 100`,
        body.posthogHost,
      ).catch(() => []),
    ]);

    // Ask LLM to summarize what's new and produce an updated knowledge base
    const changePrompt = `You are analyzing a PostHog project's recent data (last 3 days) to update the analytics knowledge base.

## All Events (${events.length} total, sorted by 30-day volume)
${events
  .sort((a, b) => (b.volume_30_day ?? 0) - (a.volume_30_day ?? 0))
  .slice(0, 150)
  .map((e) => `- ${e.name} (30d: ${e.volume_30_day ?? "?"}, last: ${e.last_seen_at ?? "?"})`)
  .join("\n")}

## Events Active in Last 3 Days (${recentNewEvents.length})
${recentNewEvents.map((e) => `- ${e.event} (3d count: ${e.cnt}, first seen: ${e.first_seen})`).join("\n")}

## App Names Active in Last 3 Days
${recentAppNames.map((a) => `- ${a.app_name} (${a.cnt} events)`).join("\n") || "None found"}

## URLs / Slugs Active in Last 3 Days (top 100)
${recentSlugs.map((u) => `- ${u.url} (${u.cnt} pageviews)`).join("\n") || "None found"}

## Event Properties (${eventProps.length})
${eventProps.slice(0, 80).map((p) => `- ${p.name} (${p.property_type ?? "unknown"})`).join("\n")}

## Person Properties (${personProps.length})
${personProps.slice(0, 40).map((p) => `- ${p.name} (${p.property_type ?? "unknown"})`).join("\n")}

## Existing Dashboards (${dashboards.length})
${dashboards.slice(0, 20).map((d) => `- ${d.name}: ${d.tiles.length} tiles`).join("\n")}

## Existing Saved Insights (${insights.length})
${insights.slice(0, 30).map((i) => `- ${i.name}`).join("\n")}

## Transaction Events
${transactions.map((t) => `- ${t.event} (${t.count})`).join("\n") || "None"}

${body.existingKnowledge ? `## Previous Knowledge Base Summary\n${body.existingKnowledge}` : ""}

Produce a JSON response:
{
  "summary": "A concise 2-3 paragraph summary of the project's analytics landscape, key events, products/apps, user flows, and any new or changed patterns in the last 3 days",
  "newFindings": ["list of notable new events, apps, slugs, or patterns discovered in the 3-day window"],
  "eventCatalog": {
    "acquisition": ["events for user acquisition"],
    "activation": ["events for user activation"],
    "engagement": ["events for feature usage"],
    "revenue": ["events for payments/transactions"],
    "retention": ["events for retention signals"],
    "errors": ["error-related events"]
  },
  "appNames": ["list of all active app_name values"],
  "keyUrls": ["important URL patterns"],
  "queryPatterns": ["useful HogQL query patterns based on the event schema"]
}

Return ONLY valid JSON.`;

    const llmResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        {
          role: "system",
          content: "You are an expert PostHog analytics engineer. Analyze the project data and produce a structured knowledge base summary. Return ONLY valid JSON.",
        },
        { role: "user", content: changePrompt },
      ],
      true,
    );

    let knowledge: Record<string, unknown>;
    try {
      let jsonStr = llmResponse.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      knowledge = JSON.parse(jsonStr);
    } catch {
      const match = llmResponse.match(/\{[\s\S]*\}/);
      knowledge = match ? JSON.parse(match[0]) : { summary: llmResponse, newFindings: [] };
    }

    return NextResponse.json({
      knowledge,
      meta: {
        eventsCount: events.length,
        recentEventsCount: recentNewEvents.length,
        appNamesCount: recentAppNames.length,
        recentUrlsCount: recentSlugs.length,
        dashboardsCount: dashboards.length,
        insightsCount: insights.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Refresh failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
