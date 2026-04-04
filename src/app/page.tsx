"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { AppStep, DashboardPayload, DatePreset, KPIPlan, SavedChart, SetupConfig } from "@/lib/types";
import { SetupWizard } from "@/components/setup-wizard";
import { ReviewPlan } from "@/components/review-plan";
import { DashboardView } from "@/components/dashboard-view";
import {
  loadState,
  saveState,
  addProject,
  updateProject,
  uid,
  type PersistedProject,
  type PersistedState,
} from "@/lib/persistence";

// Safe JSON parse from fetch response
async function safeJsonFetch(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 500) || `Server error: ${res.status}`);
  }
}

// Fetch with retry (handles timeouts and 5xx)
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(240_000) });
      // Retry on server errors
      if (res.status >= 500 && attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        continue;
      }
    }
  }
  throw lastError ?? new Error("Request failed after retries");
}

// Wrapper that does fetch + safe JSON parse + retry
async function apiCall(url: string, body: unknown) {
  const res = await fetchWithRetry(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return safeJsonFetch(res);
}

export default function Home() {
  const [step, setStep] = useState<AppStep>("setup");
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [plan, setPlan] = useState<KPIPlan | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [loadingMessage, setLoadingMessage] = useState("");
  // Enhance mode: re-enter setup with existing project context
  const [enhanceMode, setEnhanceMode] = useState(false);

  // Persistence
  const [persisted, setPersisted] = useState<PersistedState>({ projects: [], activeProjectId: null });
  const [hydrated, setHydrated] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const state = loadState();
    setPersisted(state);
    setHydrated(true);

    // Restore active project if exists
    if (state.activeProjectId) {
      const active = state.projects.find((p) => p.id === state.activeProjectId);
      if (active) {
        setConfig(active.config);
        setPlan(active.plan);
        setDashboard(active.dashboard);
        setSavedCharts(active.savedCharts || []);
        setKnowledgeBase(active.knowledgeBase || "");
        setStep("dashboard");
      }
    }
  }, []);

  // Save to localStorage when state changes
  const persistState = useCallback((newState: PersistedState) => {
    setPersisted(newState);
    saveState(newState);
  }, []);

  // Save current project state to persistence
  function persistCurrentProject(
    cfg: SetupConfig,
    p: KPIPlan,
    d: DashboardPayload,
    charts?: SavedChart[],
    kb?: string,
  ) {
    const projectId = cfg.projectId;
    const existing = persisted.projects.find((pr) => pr.projectId === projectId);
    const project: PersistedProject = {
      id: existing?.id ?? uid(),
      projectId,
      projectName: cfg.projectName,
      config: cfg,
      plan: p,
      dashboard: d,
      savedCharts: charts ?? savedCharts,
      knowledgeBase: kb ?? knowledgeBase,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const newState = addProject(persisted, project);
    persistState(newState);
  }

  // Step 1 → Step 2: Analyze (split into 2 API calls to avoid timeout)
  async function handleSetupSubmit(cfg: SetupConfig) {
    setConfig(cfg);
    setIsAnalyzing(true);
    setError("");
    setEnhanceMode(false);

    try {
      // Call 1: Agent 1 — Discovery (fetch PostHog data + LLM discovery)
      setLoadingMessage("Agent 1: Discovering events, properties, and business logic...");
      const discoverData = await apiCall("/api/analyze-discover", {
        posthogApiKey: cfg.posthogApiKey,
        posthogHost: cfg.posthogHost,
        projectId: cfg.projectId,
        projectName: cfg.projectName,
        llmProvider: cfg.llmProvider,
        llmApiKey: cfg.llmApiKey,
      });
      if (discoverData.error) throw new Error(discoverData.error);

      // Call 2: Agent 2 — Architect (design KPIs with L1/L2/L3 depth)
      setLoadingMessage("Agent 2: Designing KPIs with L1/L2/L3 depth...");
      const architectData = await apiCall("/api/analyze-architect", {
        llmProvider: cfg.llmProvider,
        llmApiKey: cfg.llmApiKey,
        discoveryContext: discoverData.discoveryContext,
        dashboardTypes: cfg.dashboardTypes,
        otherDescription: cfg.otherDescription,
        objective: cfg.objective,
        agentRecommendations: cfg.agentRecommendations,
        specificInsights: cfg.specificInsights,
      });
      if (architectData.error) throw new Error(architectData.error);
      if (!architectData.plan) throw new Error("No plan returned");

      setPlan(architectData.plan);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
      setLoadingMessage("");
    }
  }

  // Step 2 → refresh plan with feedback (single call, Agent 2 only)
  async function handleRefreshPlan(feedback: string) {
    if (!config) return;
    setIsRefreshing(true);
    setError("");

    try {
      // Re-discover if needed, but for feedback we can skip Agent 1
      // and just re-run Agent 2 with feedback
      const data = await apiCall("/api/analyze-architect", {
        llmProvider: config.llmProvider,
        llmApiKey: config.llmApiKey,
        discoveryContext: "Use the same project context as before. The user is providing feedback on the KPI plan.",
        dashboardTypes: config.dashboardTypes,
        otherDescription: config.otherDescription,
        objective: config.objective,
        agentRecommendations: config.agentRecommendations,
        specificInsights: config.specificInsights,
        feedback,
      });
      if (data.error) throw new Error(data.error);
      if (!data.plan) throw new Error("No plan returned");
      setPlan(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  // Step 2 → Step 3: Build dashboard (split into 2 calls)
  async function handleConfirmPlan(confirmedPlan: KPIPlan) {
    if (!config) return;
    setPlan(confirmedPlan);
    setIsBuilding(true);
    setError("");

    try {
      // Call 1: Generate queries + execute them
      setLoadingMessage("Agent 3: Generating HogQL queries and fetching data...");
      const queryData = await apiCall("/api/build-queries", { ...config, plan: confirmedPlan, preset: "7d", comparePreset: "7d" });
      if (queryData.error) throw new Error(queryData.error);

      // Call 2: Populate dashboard with real results
      setLoadingMessage("Agent 3: Populating dashboard with real data...");
      const popData = await apiCall("/api/build-populate", {
        llmProvider: config.llmProvider,
        llmApiKey: config.llmApiKey,
        dashboard: queryData.dashboard,
        queryResults: queryData.queryResults,
      });
      if (popData.error) throw new Error(popData.error);
      if (!popData.dashboard) throw new Error("No dashboard returned");

      setDashboard(popData.dashboard);
      setStep("dashboard");
      persistCurrentProject(config, confirmedPlan, popData.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setIsBuilding(false);
      setLoadingMessage("");
    }
  }

  // Dashboard date range change (split into 2 calls)
  async function handleRegenerate(
    preset: DatePreset, comparePreset: DatePreset,
    from?: string, to?: string, compareFrom?: string, compareTo?: string,
  ) {
    if (!config || !plan) return;
    setIsBuilding(true);
    setError("");

    try {
      setLoadingMessage("Regenerating queries...");
      const queryData = await apiCall("/api/build-queries", { ...config, plan, preset, comparePreset, from, to, compareFrom, compareTo });
      if (queryData.error) throw new Error(queryData.error);

      setLoadingMessage("Populating dashboard...");
      const popData = await apiCall("/api/build-populate", {
        llmProvider: config.llmProvider,
        llmApiKey: config.llmApiKey,
        dashboard: queryData.dashboard,
        queryResults: queryData.queryResults,
      });
      if (popData.error) throw new Error(popData.error);

      setDashboard(popData.dashboard);
      persistCurrentProject(config, plan, popData.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setIsBuilding(false);
      setLoadingMessage("");
    }
  }

  // Switch to an existing project
  function switchProject(projectId: string) {
    const proj = persisted.projects.find((p) => p.id === projectId);
    if (!proj) return;
    setConfig(proj.config);
    setPlan(proj.plan);
    setDashboard(proj.dashboard);
    setSavedCharts(proj.savedCharts || []);
    setKnowledgeBase(proj.knowledgeBase || "");
    setStep("dashboard");
    setError("");
    persistState({ ...persisted, activeProjectId: proj.id });
  }

  // Add new project (go to setup, blank slate)
  function handleAddProject() {
    setStep("setup");
    setConfig(null);
    setPlan(null);
    setDashboard(null);
    setSavedCharts([]);
    setKnowledgeBase("");
    setError("");
    setEnhanceMode(false);
  }

  // Enhance current project (go to setup WITH existing config pre-filled)
  function handleEnhance() {
    setEnhanceMode(true);
    setStep("setup");
    // Keep config, plan, dashboard so setup wizard can pre-fill
  }

  // Update saved charts in persistence
  function handleChartsUpdate(charts: SavedChart[]) {
    setSavedCharts(charts);
    if (config && plan && dashboard) {
      persistCurrentProject(config, plan, dashboard, charts);
    }
  }

  // Update knowledge base in persistence
  function handleKnowledgeUpdate(kb: string) {
    setKnowledgeBase(kb);
    if (config && plan && dashboard) {
      persistCurrentProject(config, plan, dashboard, savedCharts, kb);
    }
  }

  // Don't render until hydrated from localStorage
  if (!hydrated) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <Loader2 size={32} className="spin" />
          <h2>Loading...</h2>
        </div>
      </div>
    );
  }

  // Loading overlay with progress
  if (isAnalyzing || isBuilding) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <Loader2 size={32} className="spin" />
          <h2>{isAnalyzing ? "AI Agents analyzing your PostHog data..." : "Building your dashboard..."}</h2>
          {loadingMessage && <p className="loading-card__step">{loadingMessage}</p>}
          <p className="loading-card__sub">
            {isAnalyzing
              ? "Each agent call takes 15-30 seconds. Total ~60 seconds."
              : "Generating queries, executing against PostHog, then populating with real data."}
          </p>
          <div className="loading-card__steps">
            <div className={`loading-step ${loadingMessage.includes("Agent 1") || loadingMessage.includes("Discovering") ? "loading-step--active" : loadingMessage.includes("Agent 2") || loadingMessage.includes("Architect") || loadingMessage.includes("Designing") ? "loading-step--done" : ""}`}>
              {isAnalyzing ? "1. Discover" : "1. Generate"}
            </div>
            <div className={`loading-step ${loadingMessage.includes("Agent 2") || loadingMessage.includes("Designing") ? "loading-step--active" : loadingMessage.includes("Agent 3") || loadingMessage.includes("Populating") ? "loading-step--done" : ""}`}>
              {isAnalyzing ? "2. Architect" : "2. Execute"}
            </div>
            {!isAnalyzing && (
              <div className={`loading-step ${loadingMessage.includes("Populating") ? "loading-step--active" : ""}`}>
                3. Populate
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error && step !== "dashboard") {
    return (
      <div className="loading-overlay">
        <div className="loading-card loading-card--error">
          <h2>Something went wrong</h2>
          <p className="status status--error">{error}</p>
          <div className="loading-card__actions">
            <button className="primary-button" onClick={() => { setError(""); setStep("setup"); }}>
              Back to Setup
            </button>
            {persisted.projects.length > 0 && (
              <button className="ghost-button" onClick={() => {
                setError("");
                const last = persisted.projects[persisted.projects.length - 1];
                if (last) switchProject(last.id);
              }}>
                Go to Last Dashboard
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  switch (step) {
    case "setup":
      return <SetupWizard onSubmit={handleSetupSubmit} enhanceConfig={enhanceMode ? config : null} />;

    case "review":
      if (!config || !plan) return null;
      return (
        <ReviewPlan
          config={config}
          plan={plan}
          onConfirm={handleConfirmPlan}
          onBack={() => setStep("setup")}
          onRefresh={handleRefreshPlan}
          isRefreshing={isRefreshing}
        />
      );

    case "dashboard":
      if (!config || !plan || !dashboard) return null;
      return (
        <DashboardView
          config={config}
          plan={plan}
          payload={dashboard}
          onBack={() => setStep("review")}
          onRegenerate={handleRegenerate}
          isLoading={isBuilding}
          projects={persisted.projects}
          activeProjectId={persisted.activeProjectId}
          onSwitchProject={switchProject}
          onAddProject={handleAddProject}
          onEnhance={handleEnhance}
          savedCharts={savedCharts}
          onChartsUpdate={handleChartsUpdate}
          knowledgeBase={knowledgeBase}
          onKnowledgeUpdate={handleKnowledgeUpdate}
        />
      );
  }
}
