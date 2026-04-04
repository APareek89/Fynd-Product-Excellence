import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm-client";
import { RECOMMENDATIONS_SYSTEM_PROMPT } from "@/lib/system-prompts";
import type { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  summaryText: string;
  scope: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!body.summaryText || !body.llmApiKey) {
      return NextResponse.json({ error: "summaryText and llmApiKey required" }, { status: 400 });
    }

    const response = await callLLM(
      body.llmProvider,
      body.llmApiKey,
      [
        { role: "system", content: RECOMMENDATIONS_SYSTEM_PROMPT },
        { role: "user", content: `Scope: ${body.scope}\n\nInsight summary:\n${body.summaryText}` },
      ],
      true,
    );

    let parsed: { recommendations: string[] };
    try {
      let jsonStr = response.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      parsed = { recommendations: ["Unable to parse AI recommendations. Raw response available in console."] };
    }

    return NextResponse.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recommendations failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
