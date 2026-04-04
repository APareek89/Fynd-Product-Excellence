"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { AppStep, DashboardPayload, DatePreset, KPIPlan, SetupConfig } from "@/lib/types";
import { SetupWizard } from "@/components/setup-wizard";
import { ReviewPlan } from "@/components/review-plan";
import { DashboardView } from "@/components/dashboard-view";

export default function Home() {
  const [step, setStep] = useState<AppStep>("setup");
  const [config, setConfig] = useState<SetupConfig | null>(null);
  const [plan, setPlan] = useState<KPIPlan | null>(null);
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isBuilding, setIsBuilding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");

  // Step 1 → Step 2: Analyze events with LLM
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
      const data = (await res.json()) as { plan?: KPIPlan; error?: string };

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
      const data = (await res.json()) as { plan?: KPIPlan; error?: string };

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
      const data = (await res.json()) as { dashboard?: DashboardPayload; error?: string };

      if (data.error) throw new Error(data.error);
      if (!data.dashboard) throw new Error("No dashboard returned");

      setDashboard(data.dashboard);
      setStep("dashboard");
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
        body: JSON.stringify({
          ...config,
          plan,
          preset,
          comparePreset,
          from,
          to,
          compareFrom,
          compareTo,
        }),
      });
      const data = (await res.json()) as { dashboard?: DashboardPayload; error?: string };

      if (data.error) throw new Error(data.error);
      if (!data.dashboard) throw new Error("No dashboard returned");

      setDashboard(data.dashboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Regeneration failed");
    } finally {
      setIsBuilding(false);
    }
  }

  // Loading overlay
  if (isAnalyzing || isBuilding) {
    return (
      <div className="loading-overlay">
        <div className="loading-card">
          <Loader2 size={32} className="spin" />
          <h2>{isAnalyzing ? "Analyzing your PostHog data..." : "Building your dashboard..."}</h2>
          <p className="loading-card__sub">
            {isAnalyzing
              ? "The AI is exploring your events, properties, and URLs to propose the best KPIs for your objectives."
              : "The AI is generating HogQL queries, executing them against PostHog, and assembling your dashboard."}
          </p>
          <p className="loading-card__hint">This may take 30-60 seconds.</p>
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
          <button className="primary-button" onClick={() => { setError(""); setStep("setup"); }}>
            Back to Setup
          </button>
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
        />
      );
  }
}
