"use client";

import { useState, useMemo } from "react";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  RefreshCcw,
  Filter,
  BarChart3,
  Bookmark,
  MessageSquarePlus,
  Database,
  CheckCircle2,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type {
  DashboardPayload,
  DatePreset,
  InsightQuery,
  SetupConfig,
  KPIPlan,
  SidebarView,
  SavedChart,
} from "@/lib/types";
import { ChartsPanel } from "@/components/charts-panel";
import { MyChartsPanel } from "@/components/my-charts-panel";
import { CustomQueryPanel } from "@/components/custom-query-panel";

type Props = {
  config: SetupConfig;
  plan: KPIPlan;
  payload: DashboardPayload;
  onBack: () => void;
  onRegenerate: (preset: DatePreset, comparePreset: DatePreset, from?: string, to?: string, compareFrom?: string, compareTo?: string) => void;
  isLoading: boolean;
};

function QueryModal({ query, onClose }: { query: InsightQuery | null; onClose: () => void }) {
  if (!query) return null;
  return (
    <div className="query-overlay" onClick={onClose} role="presentation">
      <div className="query-dialog" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="query-dialog__header">
          <div>
            <p className="eyebrow">Query</p>
            <h3>{query.label}</h3>
            <p>{query.description}</p>
          </div>
          <button className="ghost-button" onClick={onClose}>Close</button>
        </div>
        <pre className="query-dialog__body">{query.sql}</pre>
      </div>
    </div>
  );
}

function QueryBadge({ queryKey, onOpen }: { queryKey?: string; onOpen: (k: string) => void }) {
  if (!queryKey) return null;
  return (
    <button className="query-badge" onClick={() => onOpen(queryKey)} aria-label="Show query">
      {"<?>"}
    </button>
  );
}

export function DashboardView({ config, plan, payload, onBack, onRegenerate, isLoading }: Props) {
  const [activeView, setActiveView] = useState<SidebarView>("dashboard");
  const [queryKey, setQueryKey] = useState<string | null>(null);
  const [preset, setPreset] = useState<DatePreset>("7d");
  const [comparePreset, setComparePreset] = useState<DatePreset>("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");

  // AI recommendations
  const [recs, setRecs] = useState<string[]>([]);
  const [recsLoading, setRecsLoading] = useState(false);

  // Refresh knowledge base
  const [refreshing, setRefreshing] = useState(false);
  const [knowledgeBase, setKnowledgeBase] = useState("");
  const [refreshResult, setRefreshResult] = useState<{ summary?: string; newFindings?: string[] } | null>(null);

  // Saved charts
  const [savedCharts, setSavedCharts] = useState<SavedChart[]>([]);

  const selectedQuery = useMemo(
    () => payload.queries.find((q) => q.key === queryKey) ?? null,
    [payload.queries, queryKey],
  );

  function applyFilters() {
    onRegenerate(preset, comparePreset, from || undefined, to || undefined, compareFrom || undefined, compareTo || undefined);
  }

  async function generateRecs() {
    setRecsLoading(true);
    try {
      const res = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          summaryText: payload.summaryText,
          scope: payload.title,
          llmProvider: config.llmProvider,
          llmApiKey: config.llmApiKey,
        }),
      });
      const data = (await res.json()) as { recommendations?: string[] };
      setRecs(data.recommendations ?? []);
    } catch {
      setRecs(["Failed to generate recommendations."]);
    } finally {
      setRecsLoading(false);
    }
  }

  // Refresh knowledge base
  async function handleRefreshKnowledge() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await fetch("/api/refresh-knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posthogApiKey: config.posthogApiKey,
          posthogHost: config.posthogHost,
          projectId: config.projectId,
          llmProvider: config.llmProvider,
          llmApiKey: config.llmApiKey,
          existingKnowledge: knowledgeBase,
        }),
      });
      const data = (await res.json()) as {
        knowledge?: { summary?: string; newFindings?: string[] };
        error?: string;
      };
      if (data.error) throw new Error(data.error);
      const k = data.knowledge ?? {};
      setKnowledgeBase(JSON.stringify(k));
      setRefreshResult({ summary: k.summary, newFindings: k.newFindings });
    } catch {
      setRefreshResult({ summary: "Failed to refresh knowledge base.", newFindings: [] });
    } finally {
      setRefreshing(false);
    }
  }

  // Saved chart management
  function handleSaveChart(chart: SavedChart) {
    setSavedCharts((prev) => [chart, ...prev]);
  }
  function handleDeleteChart(id: string) {
    setSavedCharts((prev) => prev.filter((c) => c.id !== id));
  }
  function handleRefreshChart(updated: SavedChart) {
    setSavedCharts((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Sidebar nav items
  const navItems: { key: SidebarView; label: string; icon: typeof Sparkles; badge?: number }[] = [
    { key: "dashboard", label: plan.dashboardName, icon: Sparkles },
    { key: "charts", label: "Charts", icon: BarChart3 },
    { key: "my-charts", label: "My Charts", icon: Bookmark, badge: savedCharts.length || undefined },
    { key: "custom", label: "Custom", icon: MessageSquarePlus },
  ];

  // Render active panel content
  function renderContent() {
    switch (activeView) {
      case "charts":
        return <ChartsPanel config={config} onSave={handleSaveChart} />;

      case "my-charts":
        return (
          <MyChartsPanel
            config={config}
            charts={savedCharts}
            onDelete={handleDeleteChart}
            onRefresh={handleRefreshChart}
          />
        );

      case "custom":
        return <CustomQueryPanel config={config} knowledgeBase={knowledgeBase} />;

      case "dashboard":
      default:
        return renderDashboard();
    }
  }

  function renderDashboard() {
    return (
      <>
        <header className="page-header">
          <button className="ghost-button" onClick={onBack} style={{ marginBottom: "0.5rem" }}>
            <ArrowLeft size={14} /> Reconfigure
          </button>
          <div>
            <p className="eyebrow">{config.projectName}</p>
            <h1>{payload.title}</h1>
            <p className="page-header__copy">{payload.subtitle}</p>
          </div>
        </header>

        {/* Date filters + Refresh */}
        <div className="control-card">
          <div className="control-card__top-row">
            <p className="eyebrow">Date Range</p>
            <button
              className="ghost-button"
              onClick={handleRefreshKnowledge}
              disabled={refreshing}
              title="Fetch last 3 days of events and update AI knowledge base"
            >
              {refreshing ? <Loader2 size={13} className="spin" /> : <Database size={13} />}
              {refreshing ? "Refreshing..." : "Refresh Knowledge Base"}
            </button>
          </div>

          {refreshResult && (
            <div className="refresh-result">
              <div className="refresh-result__header">
                <CheckCircle2 size={14} style={{ color: "var(--positive)" }} />
                <strong>Knowledge base updated</strong>
              </div>
              {refreshResult.summary && (
                <p className="refresh-result__summary">{refreshResult.summary}</p>
              )}
              {refreshResult.newFindings && refreshResult.newFindings.length > 0 && (
                <div className="refresh-result__findings">
                  <p className="eyebrow" style={{ marginBottom: "0.3rem" }}>New Findings</p>
                  <ul>
                    {refreshResult.newFindings.slice(0, 5).map((f, i) => (
                      <li key={i}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          <div className="filter-grid filter-grid--toolbar">
            <label className="field">
              <span>Current window</span>
              <select value={preset} onChange={(e) => setPreset(e.target.value as DatePreset)}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {preset === "custom" && (
              <>
                <label className="field">
                  <span>From</span>
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span>To</span>
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </>
            )}
            <label className="field">
              <span>Comparison window</span>
              <select value={comparePreset} onChange={(e) => setComparePreset(e.target.value as DatePreset)}>
                <option value="24h">24 hours</option>
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            {comparePreset === "custom" && (
              <>
                <label className="field">
                  <span>Compare from</span>
                  <input type="date" value={compareFrom} onChange={(e) => setCompareFrom(e.target.value)} />
                </label>
                <label className="field">
                  <span>Compare to</span>
                  <input type="date" value={compareTo} onChange={(e) => setCompareTo(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <div className="filter-actions">
            <button className="primary-button" onClick={applyFilters} disabled={isLoading}>
              {isLoading ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
              {isLoading ? "Regenerating..." : "Apply"}
            </button>
            <button className="ghost-button" onClick={() => { setPreset("7d"); setComparePreset("7d"); }}>
              <Filter size={14} /> Reset
            </button>
          </div>
        </div>

        <div className="content-panel">
          {/* Metric cards */}
          {payload.cards.length > 0 && (
            <section className="metrics-grid">
              {payload.cards.map((card) => (
                <article className="metric-card" key={card.id}>
                  <div className="metric-card__top">
                    <p className="metric-card__label">{card.label}</p>
                    <QueryBadge queryKey={card.queryKey} onOpen={setQueryKey} />
                  </div>
                  <p className="metric-card__value">{card.value}</p>
                  <div className="metric-card__bottom">
                    {card.delta && (
                      <span className={`delta-chip delta-chip--${card.deltaTone ?? "neutral"}`}>{card.delta}</span>
                    )}
                    {card.hint && <p className="metric-card__hint">{card.hint}</p>}
                  </div>
                </article>
              ))}
            </section>
          )}

          {/* Trend charts */}
          {payload.trends.map((trend) => (
            <section className="chart-card" key={trend.id}>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Trend</p>
                  <h2>{trend.title}</h2>
                  {trend.description && <p>{trend.description}</p>}
                </div>
                <QueryBadge queryKey={trend.queryKey} onOpen={setQueryKey} />
              </div>
              {trend.data.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                      <Legend />
                      <Line type="monotone" dataKey="value" stroke="var(--brand)" strokeWidth={2} name="Current" dot={false} />
                      <Line type="monotone" dataKey="comparisonValue" stroke="var(--text-soft)" strokeWidth={1.5} strokeDasharray="4 4" name="Previous" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state">No trend data available.</div>
              )}
            </section>
          ))}

          {/* Funnel charts */}
          {payload.funnels.map((funnel) => (
            <section className="chart-card" key={funnel.id}>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Funnel</p>
                  <h2>{funnel.title}</h2>
                  {funnel.description && <p>{funnel.description}</p>}
                </div>
                <QueryBadge queryKey={funnel.queryKey} onOpen={setQueryKey} />
              </div>
              {funnel.steps.length > 0 ? (
                <div className="chart-container">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={funnel.steps}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} formatter={(value: number, name: string) => { if (name === "count") return [value.toLocaleString(), "Users"]; return [value, name]; }} />
                      <Bar dataKey="count" fill="var(--brand)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="funnel-stats">
                    {funnel.steps.map((step, i) => (
                      <div key={step.label} className="funnel-stat">
                        <span className="funnel-stat__label">{step.label}</span>
                        <span className="funnel-stat__count">{step.count.toLocaleString()}</span>
                        {i > 0 && <span className={`funnel-stat__rate ${step.conversionRate < 30 ? "funnel-stat__rate--low" : ""}`}>{step.conversionRate.toFixed(1)}% conv</span>}
                        {i > 0 && <span className="funnel-stat__drop">{step.dropOff.toLocaleString()} dropped</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="empty-state">No funnel data available.</div>
              )}
            </section>
          ))}

          {/* Callouts */}
          {payload.callouts.map((c) => (
            <section className="callout-card" key={c.id}>
              <div className="section-header">
                <div>{c.eyebrow && <p className="eyebrow">{c.eyebrow}</p>}<h2>{c.title}</h2></div>
                <QueryBadge queryKey={c.queryKey} onOpen={setQueryKey} />
              </div>
              <p>{c.body}</p>
            </section>
          ))}

          {/* Tables */}
          {payload.tables.map((table) => (
            <section className="table-card" key={table.id}>
              <div className="section-header">
                <div><p className="eyebrow">Insight Table</p><h2>{table.title}</h2>{table.description && <p>{table.description}</p>}</div>
                <QueryBadge queryKey={table.queryKey} onOpen={setQueryKey} />
              </div>
              {table.rows.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr>{table.columns.map((col) => <th key={col.key} className={col.align === "right" ? "align-right" : undefined}>{col.label}</th>)}</tr></thead>
                    <tbody>{table.rows.map((row, i) => <tr key={i}>{table.columns.map((col) => <td key={col.key} className={col.align === "right" ? "align-right" : undefined}>{String(row[col.key] ?? "")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">{table.emptyState ?? "No data."}</div>
              )}
            </section>
          ))}

          {/* AI Recommendations */}
          <section className="action-panel__card">
            <div className="section-header">
              <div>
                <p className="eyebrow">AI-Powered Recommendations</p>
                <h2>Suggested Next Moves</h2>
                <p className="action-panel__copy">Generate targeted actions from the dashboard data using {config.llmProvider.toUpperCase()}.</p>
              </div>
              <button className="primary-button" onClick={generateRecs} disabled={recsLoading}>
                {recsLoading ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
                {recsLoading ? "Generating..." : "Generate Actions"}
              </button>
            </div>
            {recs.length > 0 ? (
              <ul className="recommendation-list">{recs.map((r, i) => <li key={i}>{r}</li>)}</ul>
            ) : (
              <div className="empty-state">No recommendations generated yet.</div>
            )}
          </section>
        </div>
      </>
    );
  }

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__icon">F</div>
          <div>
            <p className="brand__title">Fynd &ndash; Growth</p>
            <p className="brand__subtitle">{config.projectName}</p>
          </div>
        </div>
        <nav className="sidebar__nav">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                className={`sidebar__item ${activeView === item.key ? "sidebar__item--active" : ""}`}
                onClick={() => setActiveView(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {item.badge ? <span className="sidebar__badge">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar__footer">
          <p className="eyebrow">Info</p>
          <p>Dashboard built with {config.llmProvider.toUpperCase()} AI from {plan.kpis.length} KPIs.</p>
          {knowledgeBase && (
            <p style={{ marginTop: "0.4rem", color: "var(--positive)" }}>Knowledge base active</p>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="main-layout">
        <section className="workspace-page">
          {renderContent()}
        </section>
      </main>

      <QueryModal query={selectedQuery} onClose={() => setQueryKey(null)} />
    </div>
  );
}
