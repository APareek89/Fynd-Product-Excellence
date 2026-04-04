/* ------------------------------------------------------------------ */
/*  Shared types for Fynd – Growth                                    */
/* ------------------------------------------------------------------ */

// ---- LLM provider ----
export type LLMProvider = "openai" | "claude" | "gemini";

// ---- Additional API key ----
export type AdditionalKey = {
  id: string;
  name: string;
  key: string;
  objective: string;
  status: "untested" | "testing" | "valid" | "invalid";
  error?: string;
};

// ---- Dashboard types the user can choose ----
export type DashboardType =
  | "funnel"
  | "revenue"
  | "product-insights"
  | "product-performance"
  | "other";

export const DASHBOARD_TYPE_LABELS: Record<DashboardType, string> = {
  funnel: "Funnel",
  revenue: "Revenue",
  "product-insights": "Product Insights",
  "product-performance": "Product Performance",
  other: "Other (custom)",
};

// ---- Specific insight row ----
export type InsightType = "trend" | "data-point" | "funnel" | "analysis";
export type TrendGranularity = "daily" | "weekly" | "monthly";

export type SpecificInsight = {
  id: string;
  description: string;
  instructions: string;
  insightType: InsightType;
  trendGranularity?: TrendGranularity;
};

// ---- Setup config (Step 1 output) ----
export type SetupConfig = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  additionalKeys: AdditionalKey[];
  dashboardTypes: DashboardType[];
  otherDescription: string;
  objective: string;
  agentRecommendations: string;
  specificInsights: SpecificInsight[];
};

// ---- PostHog project ----
export type PostHogProject = {
  id: number;
  name: string;
  uuid: string;
};

// ---- PostHog event definition ----
export type EventDefinition = {
  name: string;
  volume_30_day: number | null;
  query_usage_30_day: number | null;
  last_seen_at: string | null;
};

// ---- PostHog property definition ----
export type PropertyDefinition = {
  name: string;
  property_type: string | null;
  is_numerical: boolean;
};

// ---- Date presets ----
export type DatePreset = "24h" | "7d" | "30d" | "custom";

// ---- KPI plan (Step 2) ----
export type KPIPlan = {
  dashboardName: string;
  kpis: KPIDefinition[];
};

export type KPIDefinition = {
  id: string;
  name: string;
  description: string;
  events: string[];
  filters: string;
  queryType: "trend" | "funnel" | "aggregate" | "table" | "analysis";
  trendGranularity?: TrendGranularity;
  feedbackStatus: "pending" | "approved" | "rejected";
  feedback: string;
};

// ---- Dashboard payload (Step 3 output) ----
export type DeltaTone = "positive" | "negative" | "neutral";

export type MetricCard = {
  id: string;
  label: string;
  value: string;
  delta?: string;
  deltaTone?: DeltaTone;
  hint?: string;
  queryKey?: string;
};

export type TableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type TableRow = Record<string, string | number | null>;

export type DataTable = {
  id: string;
  title: string;
  description?: string;
  columns: TableColumn[];
  rows: TableRow[];
  emptyState?: string;
  queryKey?: string;
};

export type Callout = {
  id: string;
  eyebrow?: string;
  title: string;
  body: string;
  tone?: DeltaTone;
  queryKey?: string;
};

export type TrendPoint = {
  date: string;
  value: number;
  comparisonValue?: number;
};

export type TrendChart = {
  id: string;
  title: string;
  description?: string;
  data: TrendPoint[];
  queryKey?: string;
  granularity?: TrendGranularity;
};

export type FunnelStep = {
  label: string;
  count: number;
  conversionRate: number;
  dropOff: number;
};

export type FunnelChart = {
  id: string;
  title: string;
  description?: string;
  steps: FunnelStep[];
  queryKey?: string;
};

export type InsightQuery = {
  key: string;
  label: string;
  sql: string;
  description: string;
};

export type DashboardPayload = {
  title: string;
  subtitle: string;
  cards: MetricCard[];
  tables: DataTable[];
  callouts: Callout[];
  trends: TrendChart[];
  funnels: FunnelChart[];
  queries: InsightQuery[];
  summaryText: string;
};

// ---- Full app state ----
export type AppStep = "setup" | "review" | "dashboard";
