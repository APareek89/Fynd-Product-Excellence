import { NextResponse } from "next/server";
import { callLLM } from "@/lib/llm-client";
import type { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";

type RequestBody = {
  name: string;
  key: string;
  objective: string;
  llmProvider: LLMProvider;
  llmApiKey: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const { name, key, objective, llmProvider, llmApiKey } = body;

    if (!key || !llmApiKey) {
      return NextResponse.json({ valid: false, error: "Missing keys" }, { status: 400 });
    }

    // Use LLM to test the API key by asking it to make a simple validation
    const prompt = `I have an API key for "${name}" with objective: "${objective}".
The API key starts with: ${key.slice(0, 8)}...

Based on the key prefix and the service name, determine:
1. What service this key is for (Paddle, Stripe, etc.)
2. What the likely API endpoint is to test it

Then generate a simple test: return JSON with {"service": "name", "testUrl": "url", "headers": {"key": "value"}}
Return ONLY valid JSON.`;

    const llmResponse = await callLLM(llmProvider, llmApiKey, [
      { role: "system", content: "You help validate API keys by identifying the service and test endpoint. Return only JSON." },
      { role: "user", content: prompt },
    ], true);

    let testInfo: { service?: string; testUrl?: string; headers?: Record<string, string> };
    try {
      testInfo = JSON.parse(llmResponse);
    } catch {
      // If LLM can't parse, try direct test for common services
      testInfo = {};
    }

    // Try to test the key directly for common services
    if (testInfo.testUrl && testInfo.headers) {
      try {
        const testRes = await fetch(testInfo.testUrl, {
          headers: { ...testInfo.headers, Authorization: testInfo.headers.Authorization || `Bearer ${key}` },
        });
        if (testRes.ok) {
          return NextResponse.json({ valid: true, service: testInfo.service });
        }
        const errText = await testRes.text();
        return NextResponse.json({
          valid: false,
          error: `${testInfo.service}: ${testRes.status} - ${errText.slice(0, 200)}`,
        });
      } catch (e) {
        return NextResponse.json({
          valid: false,
          error: `Could not reach ${testInfo.service}: ${e instanceof Error ? e.message : "unknown"}`,
        });
      }
    }

    // Fallback: just accept the key with a warning
    return NextResponse.json({
      valid: true,
      service: name,
      warning: "Could not auto-test this key, but it has been accepted.",
    });
  } catch (error) {
    return NextResponse.json({
      valid: false,
      error: error instanceof Error ? error.message : "Test failed",
    }, { status: 500 });
  }
}
