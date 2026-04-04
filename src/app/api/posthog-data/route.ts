/* ------------------------------------------------------------------ */
/*  Single fast endpoint: fetch ALL PostHog project data at once      */
/*  No LLM calls — just data fetching. Should complete in 5-15s.     */
/* ------------------------------------------------------------------ */

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

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
};

export async function POST(request: Request) {
  try {
    let body: RequestBody;
    try { body = (await request.json()) as RequestBody; }
    catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

    // Fetch all data in parallel — each has its own timeout
    const [events, eventProps, personProps, urls, transactions, dashboards, insights, sampleData] =
      await Promise.all([
        fetchEventDefinitions(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
        fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "event").catch(() => []),
        fetchPropertyDefinitions(body.posthogApiKey, body.projectId, body.posthogHost, "person").catch(() => []),
        sampleEventUrls(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
        sampleTransactions(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
        fetchExistingDashboards(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
        fetchExistingInsights(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
        sampleRecentEventData(body.posthogApiKey, body.projectId, body.posthogHost).catch(() => []),
      ]);

    // Build compact summaries for client-side LLM calls
    const eventsSummary = events
      .sort((a, b) => (b.volume_30_day ?? 0) - (a.volume_30_day ?? 0))
      .slice(0, 150)
      .map((e) => `${e.name} (${e.volume_30_day ?? "?"})`)
      .join("\n");

    const propsSummary = eventProps.slice(0, 60).map((p) => `${p.name}:${p.property_type ?? "?"}`).join(", ");
    const personSummary = personProps.slice(0, 30).map((p) => `${p.name}:${p.property_type ?? "?"}`).join(", ");
    const urlsSummary = urls.slice(0, 30).join("\n");
    const txSummary = transactions.map((t) => `${t.event}(${t.count})`).join(", ");

    const dashSummary = dashboards.slice(0, 15).map((d) => {
      const tiles = d.tiles.slice(0, 5).map((t) => t.name).join(", ");
      return `"${d.name}": ${tiles}`;
    }).join("\n");

    const insightSummary = insights.slice(0, 30).map((i) => i.name).join(", ");
    const sampleSummary = sampleData.slice(0, 15).map((s) => `${s.event}: ${String(s.properties).slice(0, 100)}`).join("\n");

    return NextResponse.json({
      summaries: {
        events: eventsSummary,
        eventProps: propsSummary,
        personProps: personSummary,
        urls: urlsSummary,
        transactions: txSummary,
        dashboards: dashSummary,
        insights: insightSummary,
        sampleData: sampleSummary,
      },
      meta: {
        eventsCount: events.length,
        propsCount: eventProps.length,
        personPropsCount: personProps.length,
        urlsCount: urls.length,
        txCount: transactions.length,
        dashboardsCount: dashboards.length,
        insightsCount: insights.length,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Data fetch failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
