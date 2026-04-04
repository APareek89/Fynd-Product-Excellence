import { NextResponse } from "next/server";
import { runHogQL } from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import { AGENT_3_INSIGHTS_PROMPT } from "@/lib/system-prompts";
import { resolveComparison } from "@/lib/date-range";
import type { LLMProvider, KPIPlan, DatePreset } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    try { body = (await request.json()) as RequestBody; }
    catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

    const dateBundle = resolveComparison({
      preset: body.preset || "7d",
      comparePreset: body.comparePreset || "7d",
      from: body.from, to: body.to,
      compareFrom: body.compareFrom, compareTo: body.compareTo,
    });

    const prompt = `## KPI Plan
Dashboard: ${body.plan.dashboardName}
KPIs:
${body.plan.kpis.map((k) => `- ${k.name}: ${k.description}\n  Events: ${k.events.join(", ")}\n  Filters: ${k.filters}\n  Type: ${k.queryType}${k.trendGranularity ? ` (${k.trendGranularity})` : ""}`).join("\n")}

## Date Ranges
Current: ${dateBundle.current.from} to ${dateBundle.current.to} (${dateBundle.current.label})
Comparison: ${dateBundle.comparison.from} to ${dateBundle.comparison.to} (${dateBundle.comparison.label})

## Project: ${body.projectName} (ID: ${body.projectId})

Generate the dashboard payload with HogQL queries. Return ONLY valid JSON.`;

    const llmResponse = await callLLM(
      body.llmProvider, body.llmApiKey,
      [{ role: "system", content: AGENT_3_INSIGHTS_PROMPT }, { role: "user", content: prompt }],
      true,
    );

    let dashboard;
    try { dashboard = JSON.parse(extractJson(llmResponse)); }
    catch { throw new Error("Failed to parse dashboard queries"); }

    // Ensure arrays
    dashboard.cards = dashboard.cards || [];
    dashboard.tables = dashboard.tables || [];
    dashboard.callouts = dashboard.callouts || [];
    dashboard.trends = dashboard.trends || [];
    dashboard.funnels = dashboard.funnels || [];
    dashboard.queries = dashboard.queries || [];
    dashboard.summaryText = dashboard.summaryText || "";

    // Execute queries and collect results
    const queryResults: Record<string, unknown[]> = {};
    const queryPromises = dashboard.queries.map(async (q: { key: string; sql: string }) => {
      try {
        const results = await runHogQL(body.posthogApiKey, body.projectId, q.sql, body.posthogHost);
        queryResults[q.key] = results;
      } catch {
        queryResults[q.key] = [];
      }
    });
    await Promise.all(queryPromises);

    return NextResponse.json({ dashboard, queryResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Query generation failed";
    console.error("[build-queries] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
