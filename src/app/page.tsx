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
  uid,
  type PersistedProject,
  type PersistedState,
} from "@/lib/persistence";
import { runAnalysis, runFeedback, runBuildDashboard } from "@/lib/client-orchestrator";

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
  const [enhanceMode, setEnhanceMode] = useState(false);

  // Persistence
  const [persisted, setPersisted] = useState<PersistedState>({ projects: [], activeProjectId: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const state = loadState();
    setPersisted(state);
    setHydrated(true);
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

  const persistState = useCallback((newState: PersistedState) => {
    setPersisted(newState);
    saveState(newState);
  }, []);

  function persistCurrentProject(
    cfg: SetupConfig, p: KPIPlan, d: DashboardPayload,
    charts?: SavedChart[], kb?: string,
  ) {
    const existing = persisted.projects.find((pr) => pr.projectId === cfg.projectId);
    const project: PersistedProject = {
      id: existing?.id ?? uid(),
      projectId: cfg.projectId,
      projectName: cfg.projectName,
      config: cfg, plan: p, dashboard: d,
      savedCharts: charts ?? savedCharts,
      knowledgeBase: kb ?? knowledgeBase,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    persistState(addProject(persisted, project));
  }

  // ---- Analysis: client-side orchestration ----
  async function handleSetupSubmit(cfg: SetupConfig) {
    setConfig(cfg);
    setIsAnalyzing(true);
    setError("");
    setEnhanceMode(false);
    try {
      const { plan: newPlan } = await runAnalysis(cfg, setLoadingMessage);
      setPlan(newPlan);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
      setLoadingMessage("");
    }
  }

  // ---- Feedback: just Agent 2 ----
  async function handleRefreshPlan(feedback: string) {
    if (!config) return;
    setIsRefreshing(true);
    setError("");
    try {
      const newPlan = await runFeedback(config, feedback, setLoadingMessage);
      setPlan(newPlan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setIsRefreshing(false);
      setLoadingMessage("");
    }
  }

  // ---- Build dashboard: client-side orchestration ----
  async function handleConfirmPlan(confirmedPlan: KPIPlan) {
    if (!config) return;
    setPlan(confirmedPlan);
    setIsBuilding(true);
    setError("");
    try {
      const dash = await runBuildDashboard(config, confirmedPlan, "7d", "7d", setLoadingMessage);
      setDashboard(dash);
      setStep("dashboard");
      persistCurrentProject(config, confirmedPlan, dash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed");
    } finally {
      setIsBuilding(false);
      setLoadingMessage("");
    }
  }

  // ---- Regenerate with date range ----
  async function handleRegenerate(
    preset: DatePreset, comparePreset: DatePreset,
    from?: string, to?: string, compareFrom?: string, compareTo?: string,
  ) {
    if (!config || !plan) return;
    setIsBuilding(true);
    setError("");
    try {
      const dash = await runBuildDashboard(config, plan, preset, comparePreset, setLoadingMessage, from, to, compareFrom, compareTo);
      setDashboard(dash);
      persistCurrentProject(config, plan, dash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setIsBuilding(false);
      setLoadingMessage("");
    }
  }

  // ---- Project management ----
  function switchProject(projectId: string) {
    const proj = persisted.projects.find((p) => p.id === projectId);
    if (!proj) return;
    setConfig(proj.config); setPlan(proj.plan); setDashboard(proj.dashboard);
    setSavedCharts(proj.savedCharts || []); setKnowledgeBase(proj.knowledgeBase || "");
    setStep("dashboard"); setError("");
    persistState({ ...persisted, activeProjectId: proj.id });
  }

  function handleAddProject() {
    setStep("setup"); setConfig(null); setPlan(null); setDashboard(null);
    setSavedCharts([]); setKnowledgeBase(""); setError(""); setEnhanceMode(false);
  }

  function handleEnhance() {
    setEnhanceMode(true);
    setStep("setup");
  }

  function handleChartsUpdate(charts: SavedChart[]) {
    setSavedCharts(charts);
    if (config && plan && dashboard) persistCurrentProject(config, plan, dashboard, charts);
  }

  function handleKnowledgeUpdate(kb: string) {
    setKnowledgeBase(kb);
    if (config && plan && dashboard) persistCurrentProject(config, plan, dashboard, savedCharts, kb);
  }

  if (!hydrated) {
    return (
      <div className="loading-overlay">
        <div className="loading-card"><Loader2 size={32} className="spin" /><h2>Loading...</h2></div>
      </div>
    );
  }

  // Loading overlay with progress
  if (isAnalyzing || isBuilding) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <Loader2 size={32} className="spin" />
          <h2>{isAnalyzing ? "AI Agents analyzing your data..." : "Building your dashboard..."}</h2>
          {loadingMessage && <p className="loading-card__step">{loadingMessage}</p>}
          <p className="loading-card__sub">
            Each step takes 15-30 seconds. No timeout — runs until complete.
          </p>
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
              }}>Go to Last Dashboard</button>
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
      return <ReviewPlan config={config} plan={plan} onConfirm={handleConfirmPlan} onBack={() => setStep("setup")} onRefresh={handleRefreshPlan} isRefreshing={isRefreshing} />;
    case "dashboard":
      if (!config || !plan || !dashboard) return null;
      return (
        <DashboardView
          config={config} plan={plan} payload={dashboard}
          onBack={() => setStep("review")} onRegenerate={handleRegenerate} isLoading={isBuilding}
          projects={persisted.projects} activeProjectId={persisted.activeProjectId}
          onSwitchProject={switchProject} onAddProject={handleAddProject} onEnhance={handleEnhance}
          savedCharts={savedCharts} onChartsUpdate={handleChartsUpdate}
          knowledgeBase={knowledgeBase} onKnowledgeUpdate={handleKnowledgeUpdate}
        />
      );
  }
}
