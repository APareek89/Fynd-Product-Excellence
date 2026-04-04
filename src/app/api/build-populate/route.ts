import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm-client";
import type { LLMProvider, DashboardPayload } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  llmProvider: LLMProvider;
  llmApiKey: string;
  dashboard: DashboardPayload;
  queryResults: Record<string, unknown[]>;
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

    // Trim query results to keep within token limits
    const trimmedResults = Object.fromEntries(
      Object.entries(body.queryResults).map(([key, results]) => [
        key,
        (results as unknown[]).slice(0, 30),
      ]),
    );

    const prompt = `## Dashboard Structure
${JSON.stringify(body.dashboard, null, 2)}

## Query Results
${Object.entries(trimmedResults).map(([key, results]) =>
  `### ${key}\n${JSON.stringify(results, null, 2)}`
).join("\n\n")}

Populate the dashboard with REAL values:
1. Replace all placeholders in cards with actual numbers from results
2. Fill trend data with actual date/value pairs
3. Fill funnel steps with actual counts and conversion rates
4. Fill table rows with actual data
5. Calculate deltas as percentage change between current and comparison
6. Set deltaTone: positive if good, negative if bad, neutral if unclear
7. Write callout bodies with specific numbers, root causes, and actions
8. Write a comprehensive executive summaryText

Return the COMPLETE populated dashboard as valid JSON.`;

    const response = await callLLM(
      body.llmProvider, body.llmApiKey,
      [
        { role: "system", content: "You populate analytics dashboards with real PostHog query results. Replace all placeholders with real numbers. Write insightful callouts with L1/L2/L3 depth. Return ONLY valid JSON." },
        { role: "user", content: prompt },
      ],
      true,
    );

    let final: DashboardPayload;
    try {
      final = JSON.parse(extractJson(response)) as DashboardPayload;
    } catch {
      // Fallback to unpopulated
      final = body.dashboard;
    }

    final.cards = final.cards || [];
    final.tables = final.tables || [];
    final.callouts = final.callouts || [];
    final.trends = final.trends || [];
    final.funnels = final.funnels || [];
    final.queries = final.queries || body.dashboard.queries || [];
    final.summaryText = final.summaryText || "";

    return NextResponse.json({ dashboard: final });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Populate failed";
    console.error("[build-populate] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
