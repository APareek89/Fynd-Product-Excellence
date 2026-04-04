/* ------------------------------------------------------------------ */
/*  PostHog API client (server-side, accepts dynamic API key)         */
/* ------------------------------------------------------------------ */

import type { EventDefinition, PostHogProject, PropertyDefinition } from "@/lib/types";

const DEFAULT_HOST = "https://us.posthog.com";

function host(h?: string) {
  return (h || DEFAULT_HOST).replace(/\/+$/, "");
}

function headers(apiKey: string) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

// ---- List projects for an API key (personal API key) ----
export async function listProjects(apiKey: string, posthogHost?: string): Promise<PostHogProject[]> {
  // Try organization-level first, fallback to project-scoped
  const base = host(posthogHost);

  // Project-scoped API keys: try /api/projects/
  const res = await fetch(`${base}/api/projects/`, { headers: headers(apiKey) });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`PostHog projects: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { results?: PostHogProject[] } | PostHogProject[];
  if (Array.isArray(data)) return data;
  return data.results ?? [];
}

// ---- Fetch event definitions (paginated) ----
export async function fetchEventDefinitions(
  apiKey: string,
  projectId: string,
  posthogHost?: string,
): Promise<EventDefinition[]> {
  const base = host(posthogHost);
  const allEvents: EventDefinition[] = [];
  let url: string | null = `${base}/api/projects/${projectId}/event_definitions/?limit=200`;

  while (url) {
    const res = await fetch(url, { headers: headers(apiKey) });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`PostHog events: ${res.status} ${t}`);
    }
    const page = (await res.json()) as { results: EventDefinition[]; next: string | null };
    allEvents.push(...page.results);
    url = page.next;
  }

  return allEvents;
}

// ---- Fetch property definitions (paginated) ----
export async function fetchPropertyDefinitions(
  apiKey: string,
  projectId: string,
  posthogHost?: string,
  type: "event" | "person" = "event",
): Promise<PropertyDefinition[]> {
  const base = host(posthogHost);
  const allProps: PropertyDefinition[] = [];
  let url: string | null = `${base}/api/projects/${projectId}/property_definitions/?limit=200&type=${type}`;

  while (url) {
    const res = await fetch(url, { headers: headers(apiKey) });
    if (!res.ok) break; // non-critical
    const page = (await res.json()) as { results: PropertyDefinition[]; next: string | null };
    allProps.push(...page.results);
    url = page.next;
  }

  return allProps;
}

// ---- Run HogQL query ----
export async function runHogQL<T extends Record<string, unknown>>(
  apiKey: string,
  projectId: string,
  query: string,
  posthogHost?: string,
): Promise<T[]> {
  const base = host(posthogHost);
  const res = await fetch(`${base}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HogQL failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { columns?: string[]; results?: unknown[][] };
  const columns = data.columns ?? [];
  const rows = data.results ?? [];
  return rows.map((row) =>
    Object.fromEntries(columns.map((col, i) => [col, row[i] ?? null])) as T,
  );
}

// ---- Sample recent event URLs ----
export async function sampleEventUrls(
  apiKey: string,
  projectId: string,
  posthogHost?: string,
): Promise<string[]> {
  try {
    const rows = await runHogQL<{ url: string }>(
      apiKey,
      projectId,
      `SELECT DISTINCT properties.$current_url as url
       FROM events
       WHERE event = '$pageview'
         AND properties.$current_url IS NOT NULL
         AND timestamp > now() - INTERVAL 30 DAY
       ORDER BY timestamp DESC
       LIMIT 100`,
      posthogHost,
    );
    return rows.map((r) => r.url).filter(Boolean);
  } catch {
    return [];
  }
}

// ---- Sample transaction events ----
export async function sampleTransactions(
  apiKey: string,
  projectId: string,
  posthogHost?: string,
): Promise<{ event: string; count: number }[]> {
  try {
    const rows = await runHogQL<{ event: string; cnt: number }>(
      apiKey,
      projectId,
      `SELECT event, count() as cnt
       FROM events
       WHERE timestamp > now() - INTERVAL 30 DAY
         AND (
           event ILIKE '%payment%'
           OR event ILIKE '%transaction%'
           OR event ILIKE '%purchase%'
           OR event ILIKE '%subscription%'
           OR event ILIKE '%charge%'
           OR event ILIKE '%invoice%'
           OR event ILIKE '%stripe%'
           OR event ILIKE '%paddle%'
           OR event ILIKE '%checkout%'
           OR event ILIKE '%order%'
           OR event ILIKE '%revenue%'
         )
       GROUP BY event
       ORDER BY cnt DESC
       LIMIT 50`,
      posthogHost,
    );
    return rows.map((r) => ({ event: r.event, count: Number(r.cnt) }));
  } catch {
    return [];
  }
}
