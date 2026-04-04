/* ------------------------------------------------------------------ */
/*  Multi-provider LLM client (server-side)                           */
/* ------------------------------------------------------------------ */

import type { LLMProvider } from "@/lib/types";

type Message = { role: "system" | "user" | "assistant"; content: string };

const MODEL_MAP: Record<LLMProvider, string> = {
  openai: "gpt-5.4",
  claude: "claude-opus-4-20250514",
  gemini: "gemini-2.5-pro",
};

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
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI ${res.status}: ${t}`);
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
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_MAP.claude,
      max_tokens: 16384,
      system,
      messages: userMessages,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Claude ${res.status}: ${t}`);
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
      maxOutputTokens: 16384,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_MAP.gemini}:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini ${res.status}: ${t}`);
  }
  const data = (await res.json()) as { candidates: { content: { parts: { text: string }[] } }[] };
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
}

// ---- Unified call ----
export async function callLLM(
  provider: LLMProvider,
  apiKey: string,
  messages: Message[],
  jsonMode = false,
): Promise<string> {
  switch (provider) {
    case "openai":
      return callOpenAI(apiKey, messages, jsonMode);
    case "claude":
      return callClaude(apiKey, messages, jsonMode);
    case "gemini":
      return callGemini(apiKey, messages, jsonMode);
  }
}

export function getModelName(provider: LLMProvider) {
  return MODEL_MAP[provider];
}
