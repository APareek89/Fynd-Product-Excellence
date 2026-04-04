"use client";

import { useState, useMemo } from "react";
import {
  Loader2,
  Sparkles,
  Send,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type {
  CustomQueryScope,
  CustomQueryResult,
  InsightQuery,
  SetupConfig,
} from "@/lib/types";
import { CUSTOM_SCOPE_LABELS } from "@/lib/types";

type Props = {
  config: SetupConfig;
  knowledgeBase: string;
};

const COLORS = ["#2f66f3", "#1f9b63", "#d9544f", "#f3aa66", "#b79cff"];

function QueryBadge({ queryKey, onOpen }: { queryKey?: string; onOpen: (k: string) => void }) {
  if (!queryKey) return null;
  return <button className="query-badge" onClick={() => onOpen(queryKey)}>{"<?>"}</button>;
}

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

export function CustomQueryPanel({ config, knowledgeBase }: Props) {
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<CustomQueryScope>("funnel");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<CustomQueryResult | null>(null);
  const [error, setError] = useState("");
  const [queryKey, setQueryKey] = useState<string | null>(null);
  const [history, setHistory] = useState<CustomQueryResult[]>([]);

  const selectedQuery = useMemo(
    () => result?.queries?.find((q) => q.key === queryKey) ?? null,
    [result, queryKey],
  );

  async function runQuery() {
    if (!question.trim()) return;
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/custom-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posthogApiKey: config.posthogApiKey,
          posthogHost: config.posthogHost,
          projectId: config.projectId,
          projectName: config.projectName,
          llmProvider: config.llmProvider,
          llmApiKey: config.llmApiKey,
          question,
          scope,
          knowledgeBase,
        }),
      });
      const data = (await res.json()) as { result?: CustomQueryResult; error?: string };
      if (data.error) throw new Error(data.error);
      if (!data.result) throw new Error("No result returned");

      setResult(data.result);
      setHistory((prev) => [data.result!, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runQuery();
    }
  }

  return (
    <div className="panel-stack">
      <div className="hero-panel">
        <p className="eyebrow">Custom Insights</p>
        <h1>Ask Anything</h1>
        <p className="hero-panel__subtitle">
          Ask a question in plain English. The AI will write PostHog queries, execute them, and return data-driven insights.
        </p>
      </div>

      {/* Input */}
      <section className="custom-query-input-card">
        <div className="filter-grid filter-grid--1col">
          <label className="field">
            <span>Scope (helps AI focus the analysis)</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as CustomQueryScope)}>
              {(Object.entries(CUSTOM_SCOPE_LABELS) as [CustomQueryScope, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="custom-query-prompt">
          <textarea
            className="textarea"
            rows={3}
            placeholder="e.g. What is the conversion rate from landing page to sign-up for each product? Which product has the highest drop-off?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="primary-button primary-button--lg"
            onClick={runQuery}
            disabled={isLoading || !question.trim()}
          >
            {isLoading ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            {isLoading ? "Analyzing..." : "Generate Insights"}
          </button>
        </div>
      </section>

      {error && <p className="status status--error">{error}</p>}

      {/* Result */}
      {result && (
        <>
          {/* Answer */}
          {result.answer && (
            <section className="callout-card">
              <div className="section-header">
                <div>
                  <p className="eyebrow">{CUSTOM_SCOPE_LABELS[result.scope]} &middot; Answer</p>
                  <h2>{result.question}</h2>
                </div>
                <Sparkles size={16} style={{ color: "var(--brand)" }} />
              </div>
              <p style={{ marginTop: "0.6rem", lineHeight: 1.6, fontSize: "0.78rem" }}>{result.answer}</p>
            </section>
          )}

          {/* Cards */}
          {result.cards && result.cards.length > 0 && (
            <section className="metrics-grid">
              {result.cards.map((card) => (
                <article className="metric-card" key={card.id}>
                  <div className="metric-card__top">
                    <p className="metric-card__label">{card.label}</p>
                    <QueryBadge queryKey={card.queryKey} onOpen={setQueryKey} />
                  </div>
                  <p className="metric-card__value">{card.value}</p>
                  <div className="metric-card__bottom">
                    {card.delta && <span className={`delta-chip delta-chip--${card.deltaTone ?? "neutral"}`}>{card.delta}</span>}
                    {card.hint && <p className="metric-card__hint">{card.hint}</p>}
                  </div>
                </article>
              ))}
            </section>
          )}

          {/* Trends */}
          {result.trends?.map((trend) => (
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
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={trend.data}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
                      <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
                      <Legend />
                      <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={false} name="Current" />
                      <Line type="monotone" dataKey="comparisonValue" stroke={COLORS[4]} strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="Previous" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="empty-state">No trend data.</div>
              )}
            </section>
          ))}

          {/* Callouts */}
          {result.callouts?.map((c) => (
            <section className="callout-card" key={c.id}>
              <div className="section-header">
                <div>
                  {c.eyebrow && <p className="eyebrow">{c.eyebrow}</p>}
                  <h2>{c.title}</h2>
                </div>
                <QueryBadge queryKey={c.queryKey} onOpen={setQueryKey} />
              </div>
              <p>{c.body}</p>
            </section>
          ))}

          {/* Tables */}
          {result.tables?.map((table) => (
            <section className="table-card" key={table.id}>
              <div className="section-header">
                <div>
                  <p className="eyebrow">Data</p>
                  <h2>{table.title}</h2>
                  {table.description && <p>{table.description}</p>}
                </div>
                <QueryBadge queryKey={table.queryKey} onOpen={setQueryKey} />
              </div>
              {table.rows?.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr>{table.columns.map((c) => <th key={c.key} className={c.align === "right" ? "align-right" : undefined}>{c.label}</th>)}</tr></thead>
                    <tbody>
                      {table.rows.map((row, i) => (
                        <tr key={i}>{table.columns.map((c) => <td key={c.key} className={c.align === "right" ? "align-right" : undefined}>{String(row[c.key] ?? "")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">No data.</div>
              )}
            </section>
          ))}
        </>
      )}

      {/* History */}
      {history.length > 1 && (
        <section className="chart-builder-card">
          <h2>Previous Questions</h2>
          <div className="query-history">
            {history.slice(1).map((h, i) => (
              <button key={i} className="query-history-item" onClick={() => setResult(h)}>
                <span className="query-history-scope">{CUSTOM_SCOPE_LABELS[h.scope]}</span>
                <span>{h.question}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <QueryModal query={selectedQuery} onClose={() => setQueryKey(null)} />
    </div>
  );
}
