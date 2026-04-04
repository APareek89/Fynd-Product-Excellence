import { NextResponse } from "next/server";
import {
  listProjects,
  fetchEventDefinitions,
  fetchPropertyDefinitions,
  sampleEventUrls,
  sampleTransactions,
} from "@/lib/posthog-client";

export const dynamic = "force-dynamic";

type RequestBody = {
  action: string;
  apiKey: string;
  host?: string;
  projectId?: string;
  propertyType?: "event" | "person";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { action, apiKey, host, projectId } = body;

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    switch (action) {
      case "listProjects": {
        const projects = await listProjects(apiKey, host);
        return NextResponse.json({ projects });
      }
      case "fetchEvents": {
        if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        const events = await fetchEventDefinitions(apiKey, projectId, host);
        return NextResponse.json({ events });
      }
      case "fetchProperties": {
        if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        const properties = await fetchPropertyDefinitions(apiKey, projectId, host, body.propertyType);
        return NextResponse.json({ properties });
      }
      case "fetchUrls": {
        if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        const urls = await sampleEventUrls(apiKey, projectId, host);
        return NextResponse.json({ urls });
      }
      case "fetchTransactions": {
        if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
        const transactions = await sampleTransactions(apiKey, projectId, host);
        return NextResponse.json({ transactions });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "PostHog proxy error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
