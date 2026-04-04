/* ------------------------------------------------------------------ */
/*  Client-side multi-agent orchestrator                              */
/*  Chains: PostHog data → Agent 1 → Agent 2 (for analysis)          */
/*  Chains: Agent 3 → HogQL exec → Populate (for dashboard build)    */
/*  Each step is one short server call — no timeout issues.           */
/* ------------------------------------------------------------------ */

import {
  AGENT_1_DISCOVERY_PROMPT,
  AGENT_2_ARCHITECT_PROMPT,
  AGENT_3_INSIGHTS_PROMPT,
} from "@/lib/system-prompts";
import type { KPIPlan, LLMProvider, SetupConfig, DashboardPayload, DatePreset } from "@/lib/types";
import { resolveComparison } from "@/lib/date-range";

// ---- Helpers ----

async function safeJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(text.slice(0, 500) || `Server error ${res.status}`); }
}

async function api(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await safeJson(res);
  if (data.error) throw new Error(data.error);
  return data;
}

function extractJson(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fence) s = fence[1].trim();
  if (s.startsWith("{")) return s;
  const m = s.match(/\{[\s\S]*\}/);
  return m ? m[0] : s;
}

async function llm(provider: LLMProvider, apiKey: string, systemPrompt: string, userPrompt: string) {
  const data = await api("/api/llm-proxy", { provider, apiKey, systemPrompt, userPrompt, jsonMode: true });
  return data.result as string;
}

// ---- Analysis flow (Step 1 → Step 2) ----

export type AnalysisProgress = (msg: string) => void;

export async function runAnalysis(
  config: SetupConfig,
  onProgress: AnalysisProgress,
): Promise<{ plan: KPIPlan; discoveryContext: string }> {

  // Step 1: Fetch PostHog data (fast, ~5-10s)
  onProgress("Fetching PostHog events, properties, and dashboards...");
  const phData = await api("/api/posthog-data", {
    posthogApiKey: config.posthogApiKey,
    posthogHost: config.posthogHost,
    projectId: config.projectId,
    projectName: config.projectName,
  });

  const s = phData.summaries;

  // Step 2: Agent 1 — Discovery (~15-30s)
  onProgress("Agent 1: Mapping events to business actions...");
  const discoveryPrompt = `## Project: ${config.projectName} (ID: ${config.projectId})
## Events (top by volume)\n${s.events}
## Event Properties: ${s.eventProps}
## Person Properties: ${s.personProps}
## URLs\n${s.urls}
## Transaction Events: ${s.transactions || "None"}
## Existing Dashboards\n${s.dashboards || "None"}
## Existing Insights: ${s.insights || "None"}
## Sample Data (7d)\n${s.sampleData || "None"}
Return the structured project context JSON.`;

  const discoveryContext = await llm(config.llmProvider, config.llmApiKey, AGENT_1_DISCOVERY_PROMPT, discoveryPrompt);

  // Step 3: Agent 2 — Architect (~15-30s)
  onProgress("Agent 2: Designing KPIs with L1/L2/L3 depth...");
  const insightsList = config.specificInsights.length > 0
    ? config.specificInsights.map((i, idx) => `${idx + 1}. ${i.description} [${i.insightType}]${i.instructions ? ` — ${i.instructions}` : ""}`).join("\n")
    : "None";

  const architectPrompt = `## Discovery Context\n${discoveryContext}
## Objective\n${config.objective}
## Agent Recommendations\n${config.agentRecommendations || "None"}
## Dashboard Types: ${config.dashboardTypes.join(", ")}
${config.dashboardTypes.includes("other") ? `Custom: ${config.otherDescription}` : ""}
## Specific Insights\n${insightsList}
Return the KPI plan as JSON.`;

  const architectRaw = await llm(config.llmProvider, config.llmApiKey, AGENT_2_ARCHITECT_PROMPT, architectPrompt);

  let plan: KPIPlan;
  try {
    plan = JSON.parse(extractJson(architectRaw)) as KPIPlan;
  } catch {
    throw new Error(`Could not parse KPI plan. Response: ${architectRaw.slice(0, 300)}`);
  }

  plan.kpis = plan.kpis.map((kpi, i) => ({
    ...kpi,
    id: kpi.id || `kpi-${i}`,
    feedbackStatus: "pending" as const,
    feedback: "",
  }));

  return { plan, discoveryContext };
}

// ---- Feedback flow (just Agent 2 again) ----

export async function runFeedback(
  config: SetupConfig,
  feedback: string,
  onProgress: AnalysisProgress,
): Promise<KPIPlan> {
  onProgress("Agent 2: Revising KPIs based on feedback...");

  const prompt = `The user provided feedback on the previous KPI plan. Revise accordingly.
## Objective\n${config.objective}
## Dashboard Types: ${config.dashboardTypes.join(", ")}
## Feedback\n${feedback}
Return the revised KPI plan as JSON.`;

  const raw = await llm(config.llmProvider, config.llmApiKey, AGENT_2_ARCHITECT_PROMPT, prompt);
  let plan: KPIPlan;
  try { plan = JSON.parse(extractJson(raw)) as KPIPlan; }
  catch { throw new Error("Could not parse revised plan"); }

  plan.kpis = plan.kpis.map((kpi, i) => ({
    ...kpi,
    id: kpi.id || `kpi-${i}`,
    feedbackStatus: "pending" as const,
    feedback: "",
  }));

  return plan;
}

// ---- Dashboard build flow ----

export async function runBuildDashboard(
  config: SetupConfig,
  plan: KPIPlan,
  preset: DatePreset,
  comparePreset: DatePreset,
  onProgress: AnalysisProgress,
  from?: string, to?: string, compareFrom?: string, compareTo?: string,
): Promise<DashboardPayload> {

  const dateBundle = resolveComparison({ preset, comparePreset, from, to, compareFrom, compareTo });

  // Step 1: Agent 3 — Generate query structure (~15-30s)
  onProgress("Agent 3: Generating HogQL queries...");
  const queryPrompt = `## KPI Plan
Dashboard: ${plan.dashboardName}
KPIs:
${plan.kpis.map((k) => `- ${k.name}: ${k.description}\n  Events: ${k.events.join(", ")}\n  Filters: ${k.filters}\n  Type: ${k.queryType}`).join("\n")}

## Date Ranges
Current: ${dateBundle.current.from} to ${dateBundle.current.to} (${dateBundle.current.label})
Comparison: ${dateBundle.comparison.from} to ${dateBundle.comparison.to} (${dateBundle.comparison.label})

## Project: ${config.projectName} (ID: ${config.projectId})
Generate the dashboard payload with HogQL queries. Return ONLY valid JSON.`;

  const queryRaw = await llm(config.llmProvider, config.llmApiKey, AGENT_3_INSIGHTS_PROMPT, queryPrompt);
  let dashboard: DashboardPayload;
  try { dashboard = JSON.parse(extractJson(queryRaw)) as DashboardPayload; }
  catch { throw new Error("Could not parse dashboard structure"); }

  dashboard.cards = dashboard.cards || [];
  dashboard.tables = dashboard.tables || [];
  dashboard.callouts = dashboard.callouts || [];
  dashboard.trends = dashboard.trends || [];
  dashboard.funnels = dashboard.funnels || [];
  dashboard.queries = dashboard.queries || [];
  dashboard.summaryText = dashboard.summaryText || "";

  // Step 2: Execute HogQL queries via server (~5-15s)
  if (dashboard.queries.length > 0) {
    onProgress(`Executing ${dashboard.queries.length} HogQL queries...`);
    const queryData = await api("/api/build-queries", {
      ...config,
      plan,
      preset,
      comparePreset,
      from, to, compareFrom, compareTo,
    });

    // Step 3: Populate with real data (~15-30s)
    if (queryData.queryResults && Object.keys(queryData.queryResults).length > 0) {
      onProgress("Populating dashboard with real data...");
      const populatePrompt = `## Dashboard\n${JSON.stringify(dashboard, null, 2)}
## Query Results\n${Object.entries(queryData.queryResults as Record<string, unknown[]>)
        .map(([k, v]) => `### ${k}\n${JSON.stringify((v as unknown[]).slice(0, 25))}`)
        .join("\n")}
Populate ALL values with real numbers. Return complete JSON.`;

      const popRaw = await llm(config.llmProvider, config.llmApiKey,
        "Populate analytics dashboard with real PostHog results. Replace placeholders with real numbers. Return ONLY valid JSON.",
        populatePrompt);

      try {
        const populated = JSON.parse(extractJson(popRaw)) as DashboardPayload;
        populated.queries = populated.queries || dashboard.queries;
        populated.cards = populated.cards || [];
        populated.tables = populated.tables || [];
        populated.callouts = populated.callouts || [];
        populated.trends = populated.trends || [];
        populated.funnels = populated.funnels || [];
        populated.summaryText = populated.summaryText || "";
        return populated;
      } catch {
        // Fallback to unpopulated
        return dashboard;
      }
    }
  }

  return dashboard;
}
