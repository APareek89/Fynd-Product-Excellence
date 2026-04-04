"use client";

import { useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  Play,
  Save,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type {
  ChartEventEntry,
  ChartPropertyFilter,
  ChartType,
  ChartTimePeriod,
  ChartFrequency,
  ChartDataPayload,
  SavedChart,
  SetupConfig,
} from "@/lib/types";
import {
  CHART_TYPE_LABELS,
  CHART_TIME_LABELS,
  CHART_FREQ_LABELS,
} from "@/lib/types";

type Props = {
  config: SetupConfig;
  onSave: (chart: SavedChart) => void;
};

const COLORS = ["#2f66f3", "#1f9b63", "#d9544f", "#f3aa66", "#b79cff", "#64d6c5", "#ff6b9d", "#9aa3b5"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function ChartsPanel({ config, onSave }: Props) {
  // Event series
  const [events, setEvents] = useState<ChartEventEntry[]>([
    { id: uid(), event: "", label: "", mathType: "total", mathProperty: "" },
  ]);

  // Property filters
  const [propertyFilters, setPropertyFilters] = useState<ChartPropertyFilter[]>([]);
  const [breakdownProperty, setBreakdownProperty] = useState("");

  // Chart options
  const [chartType, setChartType] = useState<ChartType>("line");
  const [timePeriod, setTimePeriod] = useState<ChartTimePeriod>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [frequency, setFrequency] = useState<ChartFrequency>("day");

  // State
  const [isLoading, setIsLoading] = useState(false);
  const [chartData, setChartData] = useState<ChartDataPayload | null>(null);
  const [error, setError] = useState("");
  const [chartName, setChartName] = useState("");
  const [showSql, setShowSql] = useState(false);

  // Event management
  function addEvent() {
    setEvents((p) => [...p, { id: uid(), event: "", label: "", mathType: "total", mathProperty: "" }]);
  }
  function removeEvent(id: string) {
    setEvents((p) => p.filter((e) => e.id !== id));
  }
  function updateEvent(id: string, patch: Partial<ChartEventEntry>) {
    setEvents((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  // Property filter management
  function addFilter() {
    setPropertyFilters((p) => [...p, { id: uid(), key: "", operator: "exact", value: "" }]);
  }
  function removeFilter(id: string) {
    setPropertyFilters((p) => p.filter((f) => f.id !== id));
  }
  function updateFilter(id: string, patch: Partial<ChartPropertyFilter>) {
    setPropertyFilters((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  // Run chart
  async function runChart() {
    const validEvents = events.filter((e) => e.event.trim());
    if (!validEvents.length) { setError("Add at least one event"); return; }

    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/custom-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posthogApiKey: config.posthogApiKey,
          posthogHost: config.posthogHost,
          projectId: config.projectId,
          events: validEvents,
          propertyFilters: propertyFilters.filter((f) => f.key),
          breakdownProperty,
          timePeriod,
          customFrom,
          customTo,
          frequency,
        }),
      });
      const data = (await res.json()) as ChartDataPayload & { error?: string };
      if (data.error) throw new Error(data.error);
      setChartData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Chart query failed");
    } finally {
      setIsLoading(false);
    }
  }

  // Save chart
  function handleSave() {
    if (!chartData || !chartName.trim()) return;
    const saved: SavedChart = {
      id: uid(),
      name: chartName,
      events: events.filter((e) => e.event.trim()),
      propertyFilters: propertyFilters.filter((f) => f.key),
      breakdownProperty,
      chartType,
      timePeriod,
      customFrom,
      customTo,
      frequency,
      createdAt: new Date().toISOString(),
      data: chartData,
    };
    onSave(saved);
    setChartName("");
  }

  // Render chart
  function renderChart() {
    if (!chartData || !chartData.data.length) return <div className="empty-state">No data to display.</div>;

    const series = chartData.series;

    switch (chartType) {
      case "line":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Legend />
              {series.map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case "cumulative-line": {
        // Compute cumulative data
        const cumData = chartData.data.map((row, idx) => {
          const point: Record<string, string | number> = { date: row.date };
          for (const s of series) {
            let sum = 0;
            for (let j = 0; j <= idx; j++) sum += Number(chartData.data[j][s] ?? 0);
            point[s] = sum;
          }
          return point;
        });
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={cumData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Legend />
              {series.map((s, i) => (
                <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );
      }

      case "bar":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Legend />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case "stacked-bar":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Legend />
              {series.map((s, i) => (
                <Bar key={s} dataKey={s} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );

      case "area":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={chartData.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--text-soft)" />
              <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12 }} />
              <Legend />
              {series.map((s, i) => (
                <Area key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case "pie": {
        // Sum all values for pie
        const totals = series.map((s) => ({
          name: s,
          value: chartData.data.reduce((sum, row) => sum + (Number(row[s]) || 0), 0),
        }));
        return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={totals} cx="50%" cy="50%" outerRadius={120} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}>
                {totals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        );
      }

      case "table": {
        return (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  {series.map((s) => <th key={s} className="align-right">{s}</th>)}
                </tr>
              </thead>
              <tbody>
                {chartData.data.map((row, i) => (
                  <tr key={i}>
                    <td>{row.date}</td>
                    {series.map((s) => <td key={s} className="align-right">{Number(row[s] ?? 0).toLocaleString()}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
  }

  return (
    <div className="panel-stack">
      <div className="hero-panel">
        <p className="eyebrow">Chart Builder</p>
        <h1>Create Custom Chart</h1>
        <p className="hero-panel__subtitle">Select events, apply filters, choose visualization type, and run your query against PostHog.</p>
      </div>

      {/* Event Series */}
      <section className="chart-builder-card">
        <div className="section-header">
          <h2>Event Series</h2>
          <button className="ghost-button" onClick={addEvent}><Plus size={14} /> Add Series</button>
        </div>

        {events.map((entry, idx) => (
          <div key={entry.id} className="chart-event-row">
            <span className="chart-event-row__num">{idx + 1}</span>
            <div className="chart-event-row__fields">
              <label className="field">
                <span>Event Name *</span>
                <input placeholder="e.g. $pageview, WATERMARK_REMOVED" value={entry.event} onChange={(e) => updateEvent(entry.id, { event: e.target.value })} />
              </label>
              <div className="filter-grid filter-grid--3col">
                <label className="field">
                  <span>Label</span>
                  <input placeholder="Display name" value={entry.label} onChange={(e) => updateEvent(entry.id, { label: e.target.value })} />
                </label>
                <label className="field">
                  <span>Aggregation</span>
                  <select value={entry.mathType} onChange={(e) => updateEvent(entry.id, { mathType: e.target.value as ChartEventEntry["mathType"] })}>
                    <option value="total">Total count</option>
                    <option value="unique">Unique users</option>
                    <option value="avg">Avg property</option>
                    <option value="sum">Sum property</option>
                    <option value="min">Min property</option>
                    <option value="max">Max property</option>
                  </select>
                </label>
                {entry.mathType !== "total" && entry.mathType !== "unique" && (
                  <label className="field">
                    <span>Property</span>
                    <input placeholder="e.g. amount" value={entry.mathProperty || ""} onChange={(e) => updateEvent(entry.id, { mathProperty: e.target.value })} />
                  </label>
                )}
              </div>
            </div>
            {events.length > 1 && (
              <button className="ghost-button ghost-button--danger" onClick={() => removeEvent(entry.id)}><Trash2 size={12} /></button>
            )}
          </div>
        ))}
      </section>

      {/* Property Filters */}
      <section className="chart-builder-card">
        <div className="section-header">
          <h2>Filters & Breakdown</h2>
          <button className="ghost-button" onClick={addFilter}><Plus size={14} /> Add Filter</button>
        </div>

        {propertyFilters.map((f) => (
          <div key={f.id} className="chart-filter-row">
            <div className="filter-grid filter-grid--3col">
              <label className="field">
                <span>Property</span>
                <input placeholder="e.g. app_name, $current_url" value={f.key} onChange={(e) => updateFilter(f.id, { key: e.target.value })} />
              </label>
              <label className="field">
                <span>Operator</span>
                <select value={f.operator} onChange={(e) => updateFilter(f.id, { operator: e.target.value as ChartPropertyFilter["operator"] })}>
                  <option value="exact">equals</option>
                  <option value="contains">contains</option>
                  <option value="not_contains">not contains</option>
                  <option value="regex">regex</option>
                  <option value="is_set">is set</option>
                  <option value="is_not_set">is not set</option>
                </select>
              </label>
              <label className="field">
                <span>Value</span>
                <input placeholder="Filter value" value={f.value} onChange={(e) => updateFilter(f.id, { value: e.target.value })} />
              </label>
            </div>
            <button className="ghost-button ghost-button--danger" onClick={() => removeFilter(f.id)}><Trash2 size={12} /></button>
          </div>
        ))}

        <label className="field" style={{ marginTop: "0.5rem" }}>
          <span>Breakdown by property (optional)</span>
          <input placeholder="e.g. app_name, user_plan, $browser" value={breakdownProperty} onChange={(e) => setBreakdownProperty(e.target.value)} />
        </label>
      </section>

      {/* Chart Options */}
      <section className="chart-builder-card">
        <h2>Chart Options</h2>
        <div className="filter-grid filter-grid--3col" style={{ marginTop: "0.5rem" }}>
          <label className="field">
            <span>Chart Type</span>
            <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
              {(Object.entries(CHART_TYPE_LABELS) as [ChartType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Time Period</span>
            <select value={timePeriod} onChange={(e) => setTimePeriod(e.target.value as ChartTimePeriod)}>
              {(Object.entries(CHART_TIME_LABELS) as [ChartTimePeriod, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Frequency</span>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value as ChartFrequency)}>
              {(Object.entries(CHART_FREQ_LABELS) as [ChartFrequency, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        </div>
        {timePeriod === "custom" && (
          <div className="filter-grid filter-grid--2col" style={{ marginTop: "0.5rem" }}>
            <label className="field"><span>From</span><input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} /></label>
          </div>
        )}
      </section>

      {/* Actions */}
      <div className="filter-actions">
        <button className="primary-button primary-button--lg" onClick={runChart} disabled={isLoading}>
          {isLoading ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
          {isLoading ? "Running..." : "Run Chart"}
        </button>
      </div>

      {error && <p className="status status--error">{error}</p>}

      {/* Chart Result */}
      {chartData && (
        <section className="chart-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">Result</p>
              <h2>{chartData.title}</h2>
            </div>
            <div className="chart-result-actions">
              <button className="ghost-button" onClick={() => setShowSql(!showSql)}>{showSql ? "Hide SQL" : "Show SQL"}</button>
            </div>
          </div>

          <div className="chart-container">{renderChart()}</div>

          {showSql && <pre className="query-dialog__body" style={{ marginTop: "0.5rem", borderRadius: 12, border: "1px solid var(--border)" }}>{chartData.sql}</pre>}

          {/* Save */}
          <div className="chart-save-row">
            <input placeholder="Chart name" value={chartName} onChange={(e) => setChartName(e.target.value)} style={{ maxWidth: 300 }} />
            <button className="primary-button" onClick={handleSave} disabled={!chartName.trim()}>
              <Save size={14} /> Save Chart
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
