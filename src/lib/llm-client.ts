/* ------------------------------------------------------------------ */
/*  Multi-provider LLM client with retry + timeout (server-side)     */
/* ------------------------------------------------------------------ */

import type { LLMProvider } from "@/lib/types";

type Message = { role: "system" | "user" | "assistant"; content: string };

const MODEL_MAP: Record<LLMProvider, string> = {
  openai: "gpt-4.1-mini",
  claude: "claude-sonnet-4-20250514",
  gemini: "gemini-2.5-flash",
};

const LLM_TIMEOUT = 120_000; // 120s per LLM call
const MAX_RETRIES = 2;
const RETRY_DELAY = 3_000; // 3s between retries

// Fetch with timeout
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = LLM_TIMEOUT): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Sleep helper
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- OpenAI ----
async function callOpenAI(apiKey: string, messages: Message[], jsonMode: boolean) {
  const body: Record<string, unknown> = {
    model: MODEL_MAP.openai,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    temperature: 0.2,
  };
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content ?? "";
}

// ---- Claude ----
async function callClaude(apiKey: string, messages: Message[], _jsonMode: boolean) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const userMessages = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_MAP.claude,
      max_tokens: 12000,
      system,
      messages: userMessages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { content: { type: string; text: string }[] };
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// ---- Gemini ----
async function callGemini(apiKey: string, messages: Message[], jsonMode: boolean) {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const contents = messages.filter((m) => m.role !== "system").map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemParts }] },
    contents,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 12000,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

// ---- Unified call with retry ----
export async function callLLM(
  provider: LLMProvider,
  apiKey: string,
  messages: Message[],
  jsonMode = false,
): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      switch (provider) {
        case "openai":
          return await callOpenAI(apiKey, messages, jsonMode);
        case "claude":
          return await callClaude(apiKey, messages, jsonMode);
        case "gemini":
          return await callGemini(apiKey, messages, jsonMode);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isTimeout = lastError.message.includes("abort");
      const isRateLimit = lastError.message.includes("429") || lastError.message.includes("rate");
      const isServerError = lastError.message.includes("500") || lastError.message.includes("502") || lastError.message.includes("503");

      if (attempt < MAX_RETRIES && (isTimeout || isRateLimit || isServerError)) {
        console.warn(`[LLM] Attempt ${attempt + 1} failed (${isTimeout ? "timeout" : "server error"}), retrying in ${RETRY_DELAY}ms...`);
        await sleep(RETRY_DELAY * (attempt + 1)); // exponential backoff
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error("LLM call failed after retries");
}

export function getModelName(provider: LLMProvider) {
  return MODEL_MAP[provider];
}
