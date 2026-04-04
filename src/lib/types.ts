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

// ---- Sidebar navigation ----
export type SidebarView =
  | "dashboard"
  | "charts"
  | "my-charts"
  | "custom";

// ---- Chart builder (Charts panel) ----
export type ChartType =
  | "line"
  | "cumulative-line"
  | "bar"
  | "area"
  | "stacked-bar"
  | "pie"
  | "table";

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  line: "Line Chart",
  "cumulative-line": "Cumulative Line",
  bar: "Bar Chart",
  area: "Area Chart",
  "stacked-bar": "Stacked Bar",
  pie: "Pie / Donut",
  table: "Table",
};

export type ChartTimePeriod = "7d" | "30d" | "this-month" | "90d" | "180d" | "custom";

export const CHART_TIME_LABELS: Record<ChartTimePeriod, string> = {
  "7d": "7 Days",
  "30d": "30 Days",
  "this-month": "This Month",
  "90d": "90 Days",
  "180d": "180 Days",
  custom: "Custom",
};

export type ChartFrequency = "hour" | "day" | "week" | "month";

export const CHART_FREQ_LABELS: Record<ChartFrequency, string> = {
  hour: "Hourly",
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
};

export type ChartEventEntry = {
  id: string;
  event: string;
  label: string;
  mathType: "total" | "unique" | "avg" | "sum" | "min" | "max";
  mathProperty?: string;
};

export type ChartPropertyFilter = {
  id: string;
  key: string;
  operator: "exact" | "contains" | "not_contains" | "regex" | "is_set" | "is_not_set";
  value: string;
};

export type SavedChart = {
  id: string;
  name: string;
  events: ChartEventEntry[];
  propertyFilters: ChartPropertyFilter[];
  breakdownProperty: string;
  chartType: ChartType;
  timePeriod: ChartTimePeriod;
  customFrom?: string;
  customTo?: string;
  frequency: ChartFrequency;
  createdAt: string;
  data?: ChartDataPayload;
};

export type ChartDataPoint = {
  date: string;
  [key: string]: string | number;
};

export type ChartDataPayload = {
  title: string;
  data: ChartDataPoint[];
  series: string[];
  sql: string;
};

// ---- Custom query (Custom panel) ----
export type CustomQueryScope =
  | "funnel"
  | "product-performance"
  | "revenue"
  | "user-behavior"
  | "engagement"
  | "retention"
  | "acquisition";

export const CUSTOM_SCOPE_LABELS: Record<CustomQueryScope, string> = {
  funnel: "Funnel Analysis",
  "product-performance": "Product Performance",
  revenue: "Revenue & Monetization",
  "user-behavior": "User Behavior & Journeys",
  engagement: "Engagement & Feature Usage",
  retention: "Retention & Churn",
  acquisition: "Acquisition & Growth",
};

export type CustomQueryResult = {
  question: string;
  scope: CustomQueryScope;
  answer: string;
  cards: MetricCard[];
  tables: DataTable[];
  trends: TrendChart[];
  callouts: Callout[];
  queries: InsightQuery[];
};

// ---- Full app state ----
export type AppStep = "setup" | "review" | "dashboard";
