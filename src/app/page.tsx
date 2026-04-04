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

  // Step 1 → Step 2: Analyze events with LLM (multi-agent)
  async function handleSetupSubmit(cfg: SetupConfig) {
    setConfig(cfg);
    setIsAnalyzing(true);
    setError("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const data = await safeJsonFetch(res);

      if (data.error) throw new Error(data.error);
      if (!data.plan) throw new Error("No plan returned from analysis");

      setPlan(data.plan);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Step 2 → refresh plan with feedback
  async function handleRefreshPlan(feedback: string) {
    if (!config) return;
    setIsRefreshing(true);
    setError("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, feedback, previousPlan: plan }),
      });
      const data = await safeJsonFetch(res);

      if (data.error) throw new Error(data.error);
      if (!data.plan) throw new Error("No plan returned");

      setPlan(data.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
    }
  }

  // Step 2 → Step 3: Build dashboard
  async function handleConfirmPlan(confirmedPlan: KPIPlan) {
    if (!config) return;
    setPlan(confirmedPlan);
    setIsBuilding(true);
    setError("");

    try {
      const res = await fetch("/api/build-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...config,
          plan: confirmedPlan,
          preset: "7d",
          comparePreset: "7d",
        }),
      });
      const data = await safeJsonFetch(res);

      if (data.error) throw new Error(data.error);
      if (!data.dashboard) throw new Error("No dashboard returned");

      setDashboard(data.dashboard);
      setStep("dashboard");

      // Persist to localStorage
      persistCurrentProject(config, confirmedPlan, data.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setIsBuilding(false);
    }
  }

  // Dashboard date range change
  async function handleRegenerate(
    preset: DatePreset,
    comparePreset: DatePreset,
    from?: string,
    to?: string,
    compareFrom?: string,
    compareTo?: string,
  ) {
    if (!config || !plan) return;
    setIsBuilding(true);
    setError("");

    try {
      const res = await fetch("/api/build-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, plan, preset, comparePreset, from, to, compareFrom, compareTo }),
      });
      const data = await safeJsonFetch(res);

      if (data.error) throw new Error(data.error);
      if (!data.dashboard) throw new Error("No dashboard returned");

      setDashboard(data.dashboard);
      // Persist updated dashboard
      persistCurrentProject(config, plan, data.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setIsBuilding(false);
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

  // Add new project (go to setup)
  function handleAddProject() {
    setStep("setup");
    setConfig(null);
    setPlan(null);
    setDashboard(null);
    setSavedCharts([]);
    setKnowledgeBase("");
    setError("");
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

  // Loading overlay
  if (isAnalyzing || isBuilding) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <Loader2 size={32} className="spin" />
          <h2>{isAnalyzing ? "AI Agents analyzing your PostHog data..." : "Building your dashboard..."}</h2>
          <p className="loading-card__sub">
            {isAnalyzing
              ? "Agent 1 is discovering events, properties, and business logic. Agent 2 is architecting KPIs with L1/L2/L3 depth."
              : "Agent 3 is generating HogQL queries, executing against PostHog, and assembling insights with root-cause analysis."}
          </p>
          <p className="loading-card__hint">This may take 30-90 seconds.</p>
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
      return <SetupWizard onSubmit={handleSetupSubmit} />;

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
          savedCharts={savedCharts}
          onChartsUpdate={handleChartsUpdate}
          knowledgeBase={knowledgeBase}
          onKnowledgeUpdate={handleKnowledgeUpdate}
        />
      );
  }
}
