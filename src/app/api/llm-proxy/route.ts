/* ------------------------------------------------------------------ */
/*  Thin LLM proxy: forwards ONE LLM call at a time.                 */
/*  Each call should complete in 15-45s with fast models.            */
/* ------------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm-client";
import type { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RequestBody = {
  provider: LLMProvider;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
};

export async function POST(request: Request) {
  try {
    let body: RequestBody;
    try { body = (await request.json()) as RequestBody; }
    catch { return NextResponse.json({ error: "Invalid request body" }, { status: 400 }); }

    if (!body.apiKey || !body.userPrompt) {
      return NextResponse.json({ error: "apiKey and userPrompt required" }, { status: 400 });
    }

    const result = await callLLM(
      body.provider,
      body.apiKey,
      [
        { role: "system", content: body.systemPrompt || "You are a helpful assistant." },
        { role: "user", content: body.userPrompt },
      ],
      body.jsonMode ?? true,
    );

    return NextResponse.json({ result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "LLM call failed";
    console.error("[llm-proxy] Error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
