/* ------------------------------------------------------------------ */
/*  localStorage persistence for dashboard state                      */
/* ------------------------------------------------------------------ */

import type { DashboardPayload, KPIPlan, SavedChart, SetupConfig } from "@/lib/types";

const STORAGE_KEY = "fynd-growth-projects";

export type PersistedProject = {
  id: string;
  projectId: string;
  projectName: string;
  config: SetupConfig;
  plan: KPIPlan;
  dashboard: DashboardPayload;
  savedCharts: SavedChart[];
  knowledgeBase: string;
  createdAt: string;
  updatedAt: string;
};

export type PersistedState = {
  projects: PersistedProject[];
  activeProjectId: string | null;
};

function defaultState(): PersistedState {
  return { projects: [], activeProjectId: null };
}

export function loadState(): PersistedState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return JSON.parse(raw) as PersistedState;
  } catch {
    return defaultState();
  }
}

export function saveState(state: PersistedState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function addProject(state: PersistedState, project: PersistedProject): PersistedState {
  // Replace if same projectId exists, otherwise add
  const existing = state.projects.findIndex((p) => p.projectId === project.projectId);
  const projects = [...state.projects];
  if (existing >= 0) {
    projects[existing] = project;
  } else {
    projects.push(project);
  }
  return { projects, activeProjectId: project.id };
}

export function removeProject(state: PersistedState, id: string): PersistedState {
  const projects = state.projects.filter((p) => p.id !== id);
  const activeProjectId = state.activeProjectId === id
    ? (projects[0]?.id ?? null)
    : state.activeProjectId;
  return { projects, activeProjectId };
}

export function updateProject(state: PersistedState, id: string, patch: Partial<PersistedProject>): PersistedState {
  const projects = state.projects.map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
  );
  return { ...state, projects };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
