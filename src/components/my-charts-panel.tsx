"use client";

import { useState } from "react";
import {
  Trash2,
  Loader2,
  RefreshCcw,
  Clock,
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
import type { SavedChart, SetupConfig } from "@/lib/types";

type Props = {
  config: SetupConfig;
  charts: SavedChart[];
  onDelete: (id: string) => void;
  onRefresh: (chart: SavedChart) => void;
};

const COLORS = ["#2f66f3", "#1f9b63", "#d9544f", "#f3aa66", "#b79cff", "#64d6c5", "#ff6b9d", "#9aa3b5"];

function MiniChart({ chart }: { chart: SavedChart }) {
  const data = chart.data?.data ?? [];
  const series = chart.data?.series ?? [];
  if (!data.length) return <div className="empty-state">No data</div>;

  switch (chart.chartType) {
    case "line":
    case "cumulative-line":
      return (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Line key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      );

    case "bar":
    case "stacked-bar":
      return (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} stackId={chart.chartType === "stacked-bar" ? "a" : undefined} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      );

    case "area":
      return (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <YAxis tick={{ fontSize: 10 }} stroke="var(--text-soft)" />
            <Tooltip contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((s, i) => (
              <Area key={s} type="monotone" dataKey={s} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.12} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      );

    case "pie": {
      const totals = series.map((s) => ({
        name: s,
        value: data.reduce((sum, row) => sum + (Number(row[s]) || 0), 0),
      }));
      return (
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={totals} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}>
              {totals.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    case "table":
      return (
        <div className="table-wrap" style={{ maxHeight: 200, overflow: "auto" }}>
          <table>
            <thead><tr><th>Date</th>{series.map((s) => <th key={s} className="align-right">{s}</th>)}</tr></thead>
            <tbody>
              {data.slice(0, 10).map((row, i) => (
                <tr key={i}><td>{row.date}</td>{series.map((s) => <td key={s} className="align-right">{Number(row[s] ?? 0).toLocaleString()}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return <div className="empty-state">Unsupported chart type</div>;
  }
}

export function MyChartsPanel({ config, charts, onDelete, onRefresh }: Props) {
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  async function handleRefresh(chart: SavedChart) {
    setRefreshingId(chart.id);
    try {
      const res = await fetch("/api/custom-chart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posthogApiKey: config.posthogApiKey,
          posthogHost: config.posthogHost,
          projectId: config.projectId,
          events: chart.events,
          propertyFilters: chart.propertyFilters,
          breakdownProperty: chart.breakdownProperty,
          timePeriod: chart.timePeriod,
          customFrom: chart.customFrom,
          customTo: chart.customTo,
          frequency: chart.frequency,
        }),
      });
      const data = await res.json();
      if (!data.error) {
        onRefresh({ ...chart, data });
      }
    } finally {
      setRefreshingId(null);
    }
  }

  if (!charts.length) {
    return (
      <div className="panel-stack">
        <div className="hero-panel">
          <p className="eyebrow">My Charts</p>
          <h1>Saved Charts</h1>
          <p className="hero-panel__subtitle">No saved charts yet. Go to Charts to create and save your first chart.</p>
        </div>
        <div className="empty-state empty-state--large">No saved charts. Create one from the Charts panel.</div>
      </div>
    );
  }

  return (
    <div className="panel-stack">
      <div className="hero-panel">
        <p className="eyebrow">My Charts</p>
        <h1>Saved Charts ({charts.length})</h1>
        <p className="hero-panel__subtitle">Your saved chart library. Refresh any chart to get the latest data.</p>
      </div>

      <div className="saved-charts-grid">
        {charts.map((chart) => (
          <section className="chart-card saved-chart-card" key={chart.id}>
            <div className="section-header">
              <div>
                <p className="eyebrow">{chart.chartType} &middot; {chart.timePeriod} &middot; {chart.frequency}</p>
                <h2>{chart.name}</h2>
                <p className="saved-chart-meta">
                  <Clock size={11} /> {new Date(chart.createdAt).toLocaleDateString()}
                  &nbsp;&middot;&nbsp;
                  {chart.events.map((e) => e.label || e.event).join(", ")}
                </p>
              </div>
              <div className="saved-chart-actions">
                <button className="ghost-button" onClick={() => handleRefresh(chart)} disabled={refreshingId === chart.id}>
                  {refreshingId === chart.id ? <Loader2 size={12} className="spin" /> : <RefreshCcw size={12} />}
                </button>
                <button className="ghost-button ghost-button--danger" onClick={() => onDelete(chart.id)}>
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
            <div className="chart-container">
              <MiniChart chart={chart} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
