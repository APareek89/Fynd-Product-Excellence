import { NextResponse } from "next/server";
import { runHogQL } from "@/lib/posthog-client";
import { callLLM } from "@/lib/llm-client";
import { CUSTOM_QUERY_SYSTEM_PROMPT } from "@/lib/system-prompts";
import type { LLMProvider, CustomQueryScope, CustomQueryResult } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RequestBody = {
  posthogApiKey: string;
  posthogHost: string;
  projectId: string;
  projectName: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
  question: string;
  scope: CustomQueryScope;
  knowledgeBase?: string;
};

const SCOPE_CONTEXT: Record<CustomQueryScope, string> = {
  funnel: "Focus on conversion funnels, step-by-step user journeys, drop-off analysis between stages. Use $pageview with URL filters, sign-up events, activation events, and payment events to build funnel sequences.",
  "product-performance": "Focus on performance metrics like load times, error rates, API latency, crash rates, feature reliability. Look for error events, timeout events, and performance-related properties.",
  revenue: "Focus on revenue metrics: MRR, ARPU, plan distribution, payment success rates, refunds, churn. Use transaction/payment events (Stripe, Paddle, custom) with amount and plan properties.",
  "user-behavior": "Focus on user journeys, navigation paths, feature discovery, session patterns. Track $pageview sequences, click events, feature usage events, and user flow through the product.",
  engagement: "Focus on feature engagement: DAU/MAU ratio, feature adoption, usage frequency, power users vs casual users. Break down by event frequency per user, session counts, and feature-specific events.",
  retention: "Focus on retention and churn: returning users, cohort retention, time between sessions, reactivation events. Use person-level analysis with first-seen vs last-seen timestamps.",
  acquisition: "Focus on acquisition channels: referrer sources, UTM parameters, landing pages, sign-up funnel from first touch. Use $referrer, UTM properties, and initial landing page URLs.",
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body.question?.trim()) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    // Step 1: Ask LLM to generate HogQL queries for the question
    const queryGenPrompt = `You are an expert PostHog analyst. A user asks a question about their product analytics. Generate HogQL queries to answer it and return a complete insight payload.

## Context
Project: ${body.projectName} (ID: ${body.projectId})
Scope: ${body.scope} — ${SCOPE_CONTEXT[body.scope]}

${body.knowledgeBase ? `## Project Knowledge Base\n${body.knowledgeBase}\n` : ""}

## User Question
"${body.question}"

## Instructions
1. Generate 1-5 HogQL queries that answer the question comprehensively
2. Return a JSON payload with the structure below
3. For each query, use the events table and proper PostHog HogQL syntax
4. Use the last 30 days as default date range unless the question specifies otherwise
5. Include comparison to the prior period where relevant

Return this JSON structure:
{
  "answer": "A clear, concise answer to the question (will be populated after queries run)",
  "cards": [
    {"id": "unique-id", "label": "METRIC NAME", "value": "{{QUERY_RESULT}}", "delta": "{{DELTA}}", "deltaTone": "positive|negative|neutral", "hint": "context", "queryKey": "q1"}
  ],
  "tables": [
    {"id": "unique-id", "title": "Table title", "columns": [{"key": "col", "label": "Col", "align": "left|right"}], "rows": [], "queryKey": "q2"}
  ],
  "trends": [
    {"id": "unique-id", "title": "Trend title", "data": [], "queryKey": "q3"}
  ],
  "callouts": [
    {"id": "unique-id", "eyebrow": "Category", "title": "Finding", "body": "Detail", "tone": "positive|negative|neutral"}
  ],
  "queries": [
    {"key": "q1", "label": "Query name", "sql": "SELECT ... FROM events WHERE ...", "description": "What this measures"}
  ]
}

Return ONLY valid JSON.`;

    const structureResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: CUSTOM_QUERY_SYSTEM_PROMPT },
        { role: "user", content: queryGenPrompt },
      ],
      true,
    );

    let structure: CustomQueryResult;
    try {
      let jsonStr = structureResponse.trim();
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      structure = JSON.parse(jsonStr);
    } catch {
      const match = structureResponse.match(/\{[\s\S]*\}/);
      if (match) structure = JSON.parse(match[0]);
      else throw new Error("Failed to parse LLM response");
    }

    structure.question = body.question;
    structure.scope = body.scope;
    structure.queries = structure.queries || [];
    structure.cards = structure.cards || [];
    structure.tables = structure.tables || [];
    structure.trends = structure.trends || [];
    structure.callouts = structure.callouts || [];

    // Step 2: Execute each query
    const queryResults = new Map<string, unknown[]>();
    for (const q of structure.queries) {
      try {
        const results = await runHogQL(body.posthogApiKey, body.projectId, q.sql, body.posthogHost);
        queryResults.set(q.key, results);
      } catch (err) {
        console.error(`Custom query ${q.key} failed:`, err);
        queryResults.set(q.key, []);
      }
    }

    // Step 3: Ask LLM to populate with real data
    const populatePrompt = `Here is the query structure and real results. Populate the dashboard with actual values.

## Original Question
"${body.question}"

## Structure
${JSON.stringify(structure, null, 2)}

## Query Results
${Array.from(queryResults.entries())
  .map(([key, results]) => `### ${key}\n${JSON.stringify(results.slice(0, 100), null, 2)}`)
  .join("\n\n")}

Populate ALL placeholders with real numbers from query results. Write a clear, data-driven "answer" field.
Calculate deltas and set deltaTone appropriately.
Fill trend data and table rows with actual values.
Write insightful callout bodies with specific numbers.

Return the COMPLETE populated JSON. No markdown fences.`;

    const populatedResponse = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: "Populate analytics insight templates with real PostHog query results. Return ONLY valid JSON with real numbers, not placeholders." },
        { role: "user", content: populatePrompt },
      ],
      true,
    );

    let final: CustomQueryResult;
    try {
      let jsonStr = populatedResponse.trim();
      if (jsonStr.startsWith("```")) jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      final = JSON.parse(jsonStr);
    } catch {
      const match = populatedResponse.match(/\{[\s\S]*\}/);
      final = match ? JSON.parse(match[0]) : structure;
    }

    final.question = body.question;
    final.scope = body.scope;
    final.queries = final.queries || structure.queries;

    return NextResponse.json({ result: final });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Custom query failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
