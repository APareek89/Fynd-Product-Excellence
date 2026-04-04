"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Check,
  X,
  MessageSquare,
  Loader2,
  Sparkles,
  RefreshCcw,
} from "lucide-react";
import type { KPIDefinition, KPIPlan, SetupConfig } from "@/lib/types";

type Props = {
  config: SetupConfig;
  plan: KPIPlan;
  onConfirm: (plan: KPIPlan) => void;
  onBack: () => void;
  onRefresh: (feedback: string) => void;
  isRefreshing: boolean;
};

export function ReviewPlan({ config, plan, onConfirm, onBack, onRefresh, isRefreshing }: Props) {
  const [kpis, setKpis] = useState<KPIDefinition[]>(
    plan.kpis.map((k) => ({ ...k, feedbackStatus: "pending" as const, feedback: "" })),
  );
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [globalFeedback, setGlobalFeedback] = useState("");

  function updateKpi(id: string, patch: Partial<KPIDefinition>) {
    setKpis((prev) => prev.map((k) => (k.id === id ? { ...k, ...patch } : k)));
  }

  function approveAll() {
    setKpis((prev) => prev.map((k) => ({ ...k, feedbackStatus: "approved" as const })));
  }

  const allDecided = kpis.every((k) => k.feedbackStatus !== "pending");
  const approvedKpis = kpis.filter((k) => k.feedbackStatus === "approved");

  function handleConfirm() {
    onConfirm({ ...plan, kpis: approvedKpis });
  }

  function handleRefresh() {
    const rejectedFeedback = kpis
      .filter((k) => k.feedbackStatus === "rejected" && k.feedback)
      .map((k) => `[${k.name}]: ${k.feedback}`)
      .join("\n");
    const combined = [globalFeedback, rejectedFeedback].filter(Boolean).join("\n\n");
    onRefresh(combined || "Please revise the KPI plan based on the rejected items.");
  }

  return (
    <div className="review-page">
      <div className="review-card">
        <div className="review-header">
          <button className="ghost-button" onClick={onBack}>
            <ArrowLeft size={14} /> Back to Setup
          </button>
          <div>
            <p className="eyebrow">Step 2 of 3</p>
            <h1>Review KPI Plan</h1>
            <p className="hero-panel__subtitle">
              Review the events and filters the AI has mapped for each KPI. Approve, reject, or provide
              feedback before building the dashboard.
            </p>
          </div>
        </div>

        <div className="review-meta">
          <div className="meta-chip"><strong>Dashboard:</strong> {plan.dashboardName}</div>
          <div className="meta-chip"><strong>Project:</strong> {config.projectName}</div>
          <div className="meta-chip"><strong>KPIs:</strong> {kpis.length}</div>
          <div className="meta-chip"><strong>Approved:</strong> {approvedKpis.length}</div>
        </div>

        <div className="review-actions-top">
          <button className="ghost-button" onClick={approveAll}>
            <Check size={14} /> Approve All
          </button>
        </div>

        <div className="kpi-table-wrap">
          <table className="kpi-table">
            <thead>
              <tr>
                <th style={{ width: "28%" }}>KPI</th>
                <th style={{ width: "22%" }}>Events</th>
                <th style={{ width: "24%" }}>Filters / Properties</th>
                <th style={{ width: "10%" }}>Type</th>
                <th style={{ width: "16%" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((kpi) => (
                <>
                  <tr
                    key={kpi.id}
                    className={
                      kpi.feedbackStatus === "approved"
                        ? "kpi-row--approved"
                        : kpi.feedbackStatus === "rejected"
                          ? "kpi-row--rejected"
                          : ""
                    }
                  >
                    <td>
                      <strong>{kpi.name}</strong>
                      <p className="kpi-desc">{kpi.description}</p>
                    </td>
                    <td>
                      <div className="event-tags">
                        {kpi.events.map((ev) => (
                          <span key={ev} className="event-tag">{ev}</span>
                        ))}
                      </div>
                    </td>
                    <td className="kpi-filters">{kpi.filters}</td>
                    <td>
                      <span className="type-badge">{kpi.queryType}</span>
                      {kpi.trendGranularity && (
                        <span className="granularity-badge">{kpi.trendGranularity}</span>
                      )}
                    </td>
                    <td>
                      <div className="kpi-actions">
                        <button
                          className={`icon-btn ${kpi.feedbackStatus === "approved" ? "icon-btn--active-green" : ""}`}
                          title="Approve"
                          onClick={() => updateKpi(kpi.id, { feedbackStatus: "approved" })}
                        >
                          <Check size={14} />
                        </button>
                        <button
                          className={`icon-btn ${kpi.feedbackStatus === "rejected" ? "icon-btn--active-red" : ""}`}
                          title="Reject"
                          onClick={() => updateKpi(kpi.id, { feedbackStatus: "rejected" })}
                        >
                          <X size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Feedback"
                          onClick={() => setFeedbackOpen(feedbackOpen === kpi.id ? null : kpi.id)}
                        >
                          <MessageSquare size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {feedbackOpen === kpi.id && (
                    <tr key={`${kpi.id}-fb`} className="feedback-row">
                      <td colSpan={5}>
                        <textarea
                          className="textarea textarea--sm"
                          rows={2}
                          placeholder="Provide correction or additional context for this KPI..."
                          value={kpi.feedback}
                          onChange={(e) => updateKpi(kpi.id, { feedback: e.target.value })}
                        />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Global feedback */}
        <div className="global-feedback">
          <label className="field">
            <span>Global Feedback (optional)</span>
            <textarea
              className="textarea"
              rows={3}
              placeholder="Overall feedback or corrections for the AI to consider..."
              value={globalFeedback}
              onChange={(e) => setGlobalFeedback(e.target.value)}
            />
          </label>
        </div>

        {/* Bottom actions */}
        <div className="review-footer">
          <button
            className="ghost-button"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
            {isRefreshing ? "Regenerating..." : "Address Feedback"}
          </button>
          <button
            className="primary-button primary-button--lg"
            onClick={handleConfirm}
            disabled={approvedKpis.length === 0}
          >
            <Sparkles size={16} />
            Confirm & Build ({approvedKpis.length} KPIs)
          </button>
        </div>
      </div>
    </div>
  );
}
