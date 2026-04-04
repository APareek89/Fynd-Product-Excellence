import { NextResponse } from "next/server";
import { runHogQL } from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import { BUILD_DASHBOARD_SYSTEM_PROMPT } from "@/lib/system-prompts";
import { resolveComparison } from "@/lib/date-range";
import type { LLMProvider, KPIPlan, DatePreset, DashboardPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  plan: KPIPlan;
  preset: DatePreset;
  comparePreset: DatePreset;
  from?: string;
  to?: string;
  compareFrom?: string;
  compareTo?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    const dateBundle = resolveComparison({
      preset: body.preset || "7d",
      comparePreset: body.comparePreset || "7d",
      from: body.from,
      to: body.to,
      compareFrom: body.compareFrom,
      compareTo: body.compareTo,
    });

    // Step 1: Ask LLM to generate the HogQL queries for each KPI
    const userPrompt = `## KPI Plan
Dashboard: ${body.plan.dashboardName}
KPIs:
${body.plan.kpis.map((k) => `- ${k.name}: ${k.description}
  Events: ${k.events.join(", ")}
  Filters: ${k.filters}
  Type: ${k.queryType}${k.trendGranularity ? ` (${k.trendGranularity})` : ""}`).join("\n")}

## Date Ranges
Current period: ${dateBundle.current.from} to ${dateBundle.current.to} (${dateBundle.current.label})
Comparison period: ${dateBundle.comparison.from} to ${dateBundle.comparison.to} (${dateBundle.comparison.label})

## Project
Name: ${body.projectName}
ID: ${body.projectId}

Generate the complete dashboard payload with all HogQL queries. For each KPI, create the appropriate visualization (card, trend, funnel, table, or callout) with executable HogQL queries.

IMPORTANT: Return the full dashboard JSON with placeholder values like "{{QUERY_RESULT}}" that I will then execute and fill in. Include all queries in the "queries" array.

Actually, generate the queries AND realistic placeholder structures. I will execute the queries separately and populate values.

Return ONLY valid JSON.`;

    const llmResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: BUILD_DASHBOARD_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      true,
    );

    // Parse dashboard structure
    let dashboard: DashboardPayload;
    try {
      let jsonStr = llmResponse.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      dashboard = JSON.parse(jsonStr) as DashboardPayload;
    } catch {
      const match = llmResponse.match(/\{[\s\S]*\}/);
      if (match) {
        dashboard = JSON.parse(match[0]) as DashboardPayload;
      } else {
        throw new Error("Failed to parse dashboard structure from LLM");
      }
    }

    // Ensure arrays exist
    dashboard.cards = dashboard.cards || [];
    dashboard.tables = dashboard.tables || [];
    dashboard.callouts = dashboard.callouts || [];
    dashboard.trends = dashboard.trends || [];
    dashboard.funnels = dashboard.funnels || [];
    dashboard.queries = dashboard.queries || [];
    dashboard.summaryText = dashboard.summaryText || "";

    // Step 2: Execute each HogQL query and populate results
    const queryResults = new Map<string, unknown[]>();

    for (const query of dashboard.queries) {
      try {
        const results = await runHogQL(
          body.posthogApiKey,
          body.projectId,
          query.sql,
          body.posthogHost,
        );
        queryResults.set(query.key, results);
      } catch (err) {
        console.error(`Query ${query.key} failed:`, err);
        queryResults.set(query.key, []);
      }
    }

    // Step 3: Ask LLM to populate the dashboard with real query results
    const populatePrompt = `Here is the dashboard structure and the real query results from PostHog.

## Dashboard Structure (template)
${JSON.stringify(dashboard, null, 2)}

## Query Results
${Array.from(queryResults.entries()).map(([key, results]) =>
  `### ${key}\n${JSON.stringify(results.slice(0, 50), null, 2)}`
).join("\n\n")}

Now populate the dashboard with REAL values from the query results:
1. Replace all placeholder values in cards with actual numbers/percentages from query results
2. Fill trend data arrays with actual date/value pairs from results
3. Fill funnel steps with actual counts and conversion rates
4. Fill table rows with actual data
5. Calculate deltas (percentage change) between current and comparison periods
6. Set deltaTone: "positive" if the change is good, "negative" if bad, "neutral" if unclear
7. Write meaningful callout bodies with specific numbers
8. Write a comprehensive summaryText with key findings

Return the COMPLETE populated dashboard as valid JSON. No markdown fences.`;

    const populatedResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: "You are a data analyst. Populate a dashboard template with real PostHog query results. Return ONLY valid JSON with the complete dashboard payload. Ensure all numbers are real from the query results, not placeholders." },
        { role: "user", content: populatePrompt },
      ],
      true,
    );

    let finalDashboard: DashboardPayload;
    try {
      let jsonStr = populatedResponse.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      finalDashboard = JSON.parse(jsonStr) as DashboardPayload;
    } catch {
      const match = populatedResponse.match(/\{[\s\S]*\}/);
      if (match) {
        finalDashboard = JSON.parse(match[0]) as DashboardPayload;
      } else {
        // Fallback to unpopulated dashboard
        finalDashboard = dashboard;
      }
    }

    // Ensure arrays exist on final
    finalDashboard.cards = finalDashboard.cards || [];
    finalDashboard.tables = finalDashboard.tables || [];
    finalDashboard.callouts = finalDashboard.callouts || [];
    finalDashboard.trends = finalDashboard.trends || [];
    finalDashboard.funnels = finalDashboard.funnels || [];
    finalDashboard.queries = finalDashboard.queries || dashboard.queries;
    finalDashboard.summaryText = finalDashboard.summaryText || "";

    return NextResponse.json({ dashboard: finalDashboard });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Build failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
