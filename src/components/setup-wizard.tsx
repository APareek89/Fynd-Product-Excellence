"use client";

import { useState } from "react";
import {
  Key,
  Brain,
  Plus,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import type {
  AdditionalKey,
  DashboardType,
  InsightType,
  LLMProvider,
  SetupConfig,
  SpecificInsight,
  TrendGranularity,
  PostHogProject,
} from "@/lib/types";
import { DASHBOARD_TYPE_LABELS } from "@/lib/types";

type Props = {
  onSubmit: (config: SetupConfig) => void;
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

const EMPTY_INSIGHT: () => SpecificInsight = () => ({
  id: uid(),
  description: "",
  instructions: "",
  insightType: "trend" as InsightType,
  trendGranularity: "daily" as TrendGranularity,
});

export function SetupWizard({ onSubmit }: Props) {
  // API keys
  const [posthogApiKey, setPosthogApiKey] = useState("");
  const [posthogHost, setPosthogHost] = useState("https://us.posthog.com");
  const [llmProvider, setLlmProvider] = useState<LLMProvider>("claude");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [additionalKeys, setAdditionalKeys] = useState<AdditionalKey[]>([]);

  // Project selection
  const [projects, setProjects] = useState<PostHogProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [projectsFetched, setProjectsFetched] = useState(false);

  // Dashboard config
  const [dashboardTypes, setDashboardTypes] = useState<DashboardType[]>([]);
  const [otherDescription, setOtherDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [agentRecommendations, setAgentRecommendations] = useState("");

  // Specific insights
  const [showInsights, setShowInsights] = useState(false);
  const [insights, setInsights] = useState<SpecificInsight[]>([]);

  // ---- Fetch projects ----
  async function fetchProjects() {
    if (!posthogApiKey.trim()) return;
    setLoadingProjects(true);
    setProjectError("");
    try {
      const res = await fetch("/api/posthog-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "listProjects", apiKey: posthogApiKey, host: posthogHost }),
      });
      const data = (await res.json()) as { projects?: PostHogProject[]; error?: string };
      if (data.error) throw new Error(data.error);
      const list = data.projects ?? [];
      setProjects(list);
      setProjectsFetched(true);
      if (list.length === 1) {
        setSelectedProjectId(String(list[0].id));
        setSelectedProjectName(list[0].name);
      }
    } catch (e) {
      setProjectError(e instanceof Error ? e.message : "Failed to fetch projects");
    } finally {
      setLoadingProjects(false);
    }
  }

  // ---- Additional key management ----
  function addKey() {
    setAdditionalKeys((k) => [
      ...k,
      { id: uid(), name: "", key: "", objective: "", status: "untested" },
    ]);
  }
  function removeKey(id: string) {
    setAdditionalKeys((k) => k.filter((x) => x.id !== id));
  }
  function updateKey(id: string, patch: Partial<AdditionalKey>) {
    setAdditionalKeys((k) => k.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  async function testKey(key: AdditionalKey) {
    updateKey(key.id, { status: "testing", error: undefined });
    try {
      const res = await fetch("/api/test-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: key.name, key: key.key, objective: key.objective, llmProvider, llmApiKey }),
      });
      const data = (await res.json()) as { valid: boolean; error?: string };
      updateKey(key.id, { status: data.valid ? "valid" : "invalid", error: data.error });
    } catch {
      updateKey(key.id, { status: "invalid", error: "Test request failed" });
    }
  }

  // ---- Dashboard type toggle ----
  function toggleType(t: DashboardType) {
    setDashboardTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }

  // ---- Insights ----
  function addInsight() {
    if (insights.length >= 10) return;
    setInsights((p) => [...p, EMPTY_INSIGHT()]);
  }
  function removeInsight(id: string) {
    setInsights((p) => p.filter((x) => x.id !== id));
  }
  function updateInsight(id: string, patch: Partial<SpecificInsight>) {
    setInsights((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  // ---- Submit ----
  function handleSubmit() {
    const proj = projects.find((p) => String(p.id) === selectedProjectId);
    onSubmit({
      posthogApiKey,
      posthogHost,
      projectId: selectedProjectId,
      projectName: proj?.name ?? selectedProjectName,
      llmProvider,
      llmApiKey,
      additionalKeys,
      dashboardTypes,
      otherDescription,
      objective,
      agentRecommendations,
      specificInsights: insights.filter((i) => i.description.trim()),
    });
  }

  const canSubmit =
    posthogApiKey.trim() &&
    llmApiKey.trim() &&
    selectedProjectId &&
    dashboardTypes.length > 0 &&
    objective.trim();

  return (
    <div className="setup-wizard">
      <div className="setup-card">
        <div className="setup-card__header">
          <div className="brand__icon brand__icon--lg">F</div>
          <div>
            <h1>Fynd &ndash; Growth</h1>
            <p className="hero-panel__subtitle">
              AI-powered PostHog dashboard builder. Configure your keys, select insights, and let AI build your dashboard.
            </p>
          </div>
        </div>

        {/* Section 1: API Keys */}
        <section className="setup-section">
          <div className="setup-section__title">
            <Key size={16} />
            <h2>API Configuration</h2>
          </div>

          <div className="filter-grid filter-grid--2col">
            <label className="field">
              <span>PostHog API Key *</span>
              <input
                type="password"
                placeholder="phx_..."
                value={posthogApiKey}
                onChange={(e) => { setPosthogApiKey(e.target.value); setProjectsFetched(false); }}
              />
            </label>
            <label className="field">
              <span>PostHog Host</span>
              <select value={posthogHost} onChange={(e) => setPosthogHost(e.target.value)}>
                <option value="https://us.posthog.com">US Cloud (us.posthog.com)</option>
                <option value="https://eu.posthog.com">EU Cloud (eu.posthog.com)</option>
              </select>
            </label>
          </div>

          {!projectsFetched && (
            <div className="filter-actions">
              <button className="primary-button" onClick={fetchProjects} disabled={loadingProjects || !posthogApiKey.trim()}>
                {loadingProjects ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                {loadingProjects ? "Fetching projects..." : "Connect & Fetch Projects"}
              </button>
            </div>
          )}

          {projectError && <p className="status status--error">{projectError}</p>}

          {projectsFetched && projects.length > 0 && (
            <div className="filter-grid filter-grid--1col" style={{ marginTop: "0.65rem" }}>
              <label className="field">
                <span>Select Project *</span>
                <select
                  value={selectedProjectId}
                  onChange={(e) => {
                    setSelectedProjectId(e.target.value);
                    const p = projects.find((x) => String(x.id) === e.target.value);
                    setSelectedProjectName(p?.name ?? "");
                  }}
                >
                  <option value="">-- Select a project --</option>
                  {projects.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name} (ID: {p.id})
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <div className="filter-grid filter-grid--2col" style={{ marginTop: "0.65rem" }}>
            <label className="field">
              <span>LLM Provider *</span>
              <select value={llmProvider} onChange={(e) => setLlmProvider(e.target.value as LLMProvider)}>
                <option value="claude">Claude (Opus 4)</option>
                <option value="openai">OpenAI (GPT-5.4)</option>
                <option value="gemini">Gemini (2.5 Pro)</option>
              </select>
            </label>
            <label className="field">
              <span>LLM API Key *</span>
              <input
                type="password"
                placeholder="Enter API key"
                value={llmApiKey}
                onChange={(e) => setLlmApiKey(e.target.value)}
              />
            </label>
          </div>
        </section>

        {/* Section 2: Additional API Keys */}
        <section className="setup-section">
          <div className="setup-section__title">
            <Brain size={16} />
            <h2>Additional API Keys <span className="text-muted">(optional)</span></h2>
          </div>
          <p className="setup-hint">
            Add keys for external services (Paddle, Stripe, etc.). The AI agent will test each key and use them for enriched insights.
          </p>

          {additionalKeys.map((ak) => (
            <div key={ak.id} className="additional-key-row">
              <div className="filter-grid filter-grid--3col">
                <label className="field">
                  <span>Key Name</span>
                  <input
                    placeholder="e.g. Paddle API"
                    value={ak.name}
                    onChange={(e) => updateKey(ak.id, { name: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    placeholder="Enter key"
                    value={ak.key}
                    onChange={(e) => updateKey(ak.id, { key: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Objective</span>
                  <input
                    placeholder="What data should this fetch?"
                    value={ak.objective}
                    onChange={(e) => updateKey(ak.id, { objective: e.target.value })}
                  />
                </label>
              </div>
              <div className="additional-key-actions">
                <button
                  className="ghost-button"
                  onClick={() => testKey(ak)}
                  disabled={ak.status === "testing" || !ak.key.trim()}
                >
                  {ak.status === "testing" ? <Loader2 size={12} className="spin" /> : null}
                  Test Key
                </button>
                {ak.status === "valid" && (
                  <span className="key-status key-status--valid"><CheckCircle2 size={12} /> Valid</span>
                )}
                {ak.status === "invalid" && (
                  <span className="key-status key-status--invalid">
                    <XCircle size={12} /> {ak.error || "Invalid"}
                    <button className="ghost-button ghost-button--sm" onClick={() => updateKey(ak.id, { status: "untested" })}>
                      Proceed anyway
                    </button>
                  </span>
                )}
                <button className="ghost-button ghost-button--danger" onClick={() => removeKey(ak.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}

          <button className="ghost-button" onClick={addKey}>
            <Plus size={14} /> Add API Key
          </button>
        </section>

        {/* Section 3: Dashboard Types */}
        {selectedProjectId && (
          <section className="setup-section">
            <div className="setup-section__title">
              <Sparkles size={16} />
              <h2>Dashboard Configuration</h2>
            </div>

            <div className="filter-grid filter-grid--1col">
              <div className="field">
                <span>Select Dashboard Types * (select multiple)</span>
                <div className="chip-grid">
                  {(Object.entries(DASHBOARD_TYPE_LABELS) as [DashboardType, string][]).map(
                    ([key, label]) => (
                      <button
                        key={key}
                        className={`chip ${dashboardTypes.includes(key) ? "chip--active" : ""}`}
                        onClick={() => toggleType(key)}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </div>

            {dashboardTypes.includes("other") && (
              <label className="field" style={{ marginTop: "0.5rem" }}>
                <span>Describe what insights you want</span>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Describe the custom insights you need..."
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                />
              </label>
            )}

            <div className="filter-grid filter-grid--1col" style={{ marginTop: "0.65rem" }}>
              <label className="field">
                <span>Dashboard Objective * (guides AI recommendations)</span>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="e.g., Track user acquisition funnel from landing page to paid conversion. Focus on identifying drop-off points and revenue optimization opportunities."
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Agent Recommendations (optional)</span>
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="e.g., Ignore internal test events. Focus on events from watermarkremover.io domain. Group by user_plan property."
                  value={agentRecommendations}
                  onChange={(e) => setAgentRecommendations(e.target.value)}
                />
              </label>
            </div>
          </section>
        )}

        {/* Section 4: Specific Insights */}
        {selectedProjectId && dashboardTypes.length > 0 && (
          <section className="setup-section">
            <button
              className="setup-section__toggle"
              onClick={() => setShowInsights(!showInsights)}
            >
              <div className="setup-section__title">
                <AlertCircle size={16} />
                <h2>Specific Insights <span className="text-muted">(optional)</span></h2>
              </div>
              {showInsights ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showInsights && (
              <div className="insights-form">
                <p className="setup-hint">
                  Define up to 10 specific insights you need. The AI will map these to the right events and queries.
                </p>

                {insights.map((insight, idx) => (
                  <div key={insight.id} className="insight-row">
                    <div className="insight-row__num">{idx + 1}</div>
                    <div className="insight-row__fields">
                      <label className="field">
                        <span>Insight Description *</span>
                        <input
                          placeholder="e.g., Daily unique users who completed watermark removal"
                          value={insight.description}
                          onChange={(e) => updateInsight(insight.id, { description: e.target.value })}
                        />
                      </label>
                      <div className="filter-grid filter-grid--2col">
                        <label className="field">
                          <span>Events / Instructions (optional)</span>
                          <input
                            placeholder="e.g., Use WATERMARK_REMOVED event"
                            value={insight.instructions}
                            onChange={(e) => updateInsight(insight.id, { instructions: e.target.value })}
                          />
                        </label>
                        <label className="field">
                          <span>Insight Type</span>
                          <select
                            value={insight.insightType}
                            onChange={(e) => updateInsight(insight.id, { insightType: e.target.value as InsightType })}
                          >
                            <option value="trend">Trend</option>
                            <option value="data-point">Data Point</option>
                            <option value="funnel">Funnel</option>
                            <option value="analysis">Analysis</option>
                          </select>
                        </label>
                      </div>
                      {insight.insightType === "trend" && (
                        <label className="field">
                          <span>Trend Granularity</span>
                          <select
                            value={insight.trendGranularity || "daily"}
                            onChange={(e) =>
                              updateInsight(insight.id, { trendGranularity: e.target.value as TrendGranularity })
                            }
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="monthly">Monthly</option>
                          </select>
                        </label>
                      )}
                    </div>
                    <button className="ghost-button ghost-button--danger" onClick={() => removeInsight(insight.id)}>
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}

                {insights.length < 10 && (
                  <button className="ghost-button" onClick={addInsight}>
                    <Plus size={14} /> Add Insight
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Submit */}
        <div className="setup-footer">
          <button className="primary-button primary-button--lg" onClick={handleSubmit} disabled={!canSubmit}>
            <Sparkles size={16} />
            Build Dashboard
          </button>
          {!canSubmit && (
            <p className="setup-hint">
              Fill in all required fields (*) to proceed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
