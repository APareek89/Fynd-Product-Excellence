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
import { AGENT_1_DISCOVERY_PROMPT, AGENT_2_ARCHITECT_PROMPT } from "@/lib/system-prompts";
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Robustly extract JSON from an LLM response that may contain markdown fences,
 *  preamble text, or trailing commentary. */
function extractJson(raw: string): string {
  let s = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    s = fenceMatch[1].trim();
  }

  // If the string already starts with { we're good
  if (s.startsWith("{")) return s;

  // Otherwise try to find the outermost JSON object
  const objMatch = s.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];

  // Last resort — return as-is and let JSON.parse throw
  return s;
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Top-level try/catch — every exit path returns valid JSON
  try {
    // --- Parse request body safely ---
    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch (parseErr) {
      return NextResponse.json(
        { error: `Invalid request body: ${parseErr instanceof Error ? parseErr.message : "could not parse JSON"}` },
        { status: 400 },
      );
    }

    // =====================================================================
    // STEP 1 — Agent 1: Discovery
    // Fetch all PostHog data in parallel, then ask the LLM to synthesise
    // a structured project context.
    // =====================================================================

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

    // --- Build summaries for Agent 1 ---

    const eventsSummary = events
      .sort((a, b) => (b.volume_30_day ?? 0) - (a.volume_30_day ?? 0))
      .slice(0, 200)
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

    const dashboardsSummary =
      existingDashboards.length > 0
        ? existingDashboards
            .map((d) => {
              const tilesSummary = d.tiles
                .slice(0, 10)
                .map((t) => {
                  let queryInfo = "";
                  try {
                    const q = JSON.parse(t.query || "{}");
                    const f = JSON.parse(t.filters || "{}");
                    const evts = (q.series || f.events || [])
                      .map((e: { event?: string; name?: string }) => e.event || e.name)
                      .filter(Boolean);
                    const props = (q.properties || f.properties || []).map(
                      (p: { key?: string; value?: unknown }) => `${p.key}=${JSON.stringify(p.value)}`,
                    );
                    queryInfo = [
                      evts.length ? `Events: ${evts.join(", ")}` : "",
                      props.length ? `Filters: ${props.join(", ")}` : "",
                    ]
                      .filter(Boolean)
                      .join(" | ");
                  } catch {
                    /* ignore parse errors */
                  }
                  return `    - ${t.name}${queryInfo ? ` [${queryInfo}]` : ""}`;
                })
                .join("\n");
              return `  Dashboard: "${d.name}"${d.description ? ` — ${d.description}` : ""}\n${tilesSummary}`;
            })
            .join("\n\n")
        : "No existing dashboards found";

    const savedInsightsSummary =
      existingInsights.length > 0
        ? existingInsights
            .slice(0, 50)
            .map((i) => {
              let queryInfo = "";
              try {
                const q = JSON.parse(i.query || "{}");
                const f = JSON.parse(i.filters || "{}");
                const evts = (q.series || f.events || [])
                  .map((e: { event?: string; name?: string }) => e.event || e.name)
                  .filter(Boolean);
                const props = (q.properties || f.properties || []).map(
                  (p: { key?: string; value?: unknown }) => `${p.key}=${JSON.stringify(p.value)}`,
                );
                queryInfo = [
                  evts.length ? `Events: ${evts.join(", ")}` : "",
                  props.length ? `Filters: ${props.join(", ")}` : "",
                ]
                  .filter(Boolean)
                  .join(" | ");
              } catch {
                /* ignore */
              }
              return `  - ${i.name}${i.description ? ` (${i.description})` : ""}${queryInfo ? ` [${queryInfo}]` : ""}`;
            })
            .join("\n")
        : "No saved insights found";

    const sampleDataSummary =
      sampleData.length > 0
        ? sampleData.slice(0, 30).map((s) => `  - ${s.event}: ${s.properties}`).join("\n")
        : "No sample data available";

    const discoveryUserPrompt = `## Project: ${body.projectName} (ID: ${body.projectId})

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

## Existing Dashboards in Project
${dashboardsSummary}

## Existing Saved Insights
${savedInsightsSummary}

## Sample Event Data (past 7 days)
${sampleDataSummary}

Analyze this data and return a structured project context as JSON.`;

    // --- Call Agent 1 (Discovery) ---

    const discoveryRaw = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: AGENT_1_DISCOVERY_PROMPT },
        { role: "user", content: discoveryUserPrompt },
      ],
      true,
    );

    // We pass the raw discovery output to Agent 2 — no need to parse it as
    // structured JSON ourselves; Agent 2 consumes it as context.
    const discoveryContext = discoveryRaw;

    // =====================================================================
    // STEP 2 — Agent 2: Architect
    // Combine discovery context with user objectives to produce the KPI plan.
    // =====================================================================

    const insightsSummary =
      body.specificInsights.length > 0
        ? body.specificInsights
            .map(
              (i, idx) =>
                `${idx + 1}. ${i.description} [Type: ${i.insightType}${i.trendGranularity ? `, Granularity: ${i.trendGranularity}` : ""}]${i.instructions ? ` — Instructions: ${i.instructions}` : ""}`,
            )
            .join("\n")
        : "None provided";

    const feedbackSection = body.feedback
      ? `\n\n--- USER FEEDBACK ON PREVIOUS PLAN ---\n${body.feedback}\n\nPlease revise the plan based on this feedback.\n`
      : "";

    const architectUserPrompt = `## Discovery Context (from Agent 1)
${discoveryContext}

## User Objectives
${body.objective}

## Agent Recommendations
${body.agentRecommendations || "None provided"}

## Dashboard Types Requested: ${body.dashboardTypes.join(", ")}
${body.dashboardTypes.includes("other") ? `Custom description: ${body.otherDescription}` : ""}

## Specific Insights Requested
${insightsSummary}
${feedbackSection}

Now produce the KPI plan as JSON.`;

    // --- Call Agent 2 (Architect) ---

    const architectRaw = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: AGENT_2_ARCHITECT_PROMPT },
        { role: "user", content: architectUserPrompt },
      ],
      true,
    );

    // =====================================================================
    // Parse LLM output into KPIPlan
    // =====================================================================

    let plan: KPIPlan;
    try {
      plan = JSON.parse(extractJson(architectRaw)) as KPIPlan;
    } catch {
      // If robust extraction still fails, surface a clear error
      throw new Error(
        `Failed to parse Architect LLM response as JSON. First 500 chars: ${architectRaw.slice(0, 500)}`,
      );
    }

    // Ensure each KPI has an id and default feedback fields
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
        existingDashboardsCount: existingDashboards.length,
        existingInsightsCount: existingInsights.length,
        sampleDataRows: sampleData.length,
      },
    });
  } catch (error) {
    // Catch absolutely everything — always return valid JSON
    const message = error instanceof Error ? error.message : "Analysis failed";
    console.error("[analyze/route] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
