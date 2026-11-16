/** Provider gratis yang didukung. Urutan = prioritas kalau AI_PROVIDER nggak diisi. */
const PROVIDERS = [
  {
    id: "groq",
    label: "Groq (gratis)",
    keyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "openai/gpt-oss-120b",
    base: "https://api.groq.com/openai/v1",
  },
  {
    id: "gemini",
    label: "Google Gemini (gratis)",
    keyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: "gemini-2.5-flash",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "openrouter",
    label: "OpenRouter (:free)",
    keyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    base: "https://openrouter.ai/api/v1",
  },
];

export function pickProvider(env) {
  // Endpoint OpenAI-compatible custom (provider lain, proxy, atau mock saat test).
  if ((env.AI_BASE_URL || "").trim() && (env.AI_API_KEY || "").trim()) {
    return {
      id: "custom",
      label: "Provider custom",
      key: env.AI_API_KEY.trim(),
      base: env.AI_BASE_URL.trim().replace(/\/+$/, ""),
      model: (env.AI_MODEL || "").trim() || "default",
    };
  }

  const wanted = (env.AI_PROVIDER || "").trim().toLowerCase();
  const pool = wanted ? PROVIDERS.filter((p) => p.id === wanted) : PROVIDERS;
  for (const provider of pool) {
    const key = (env[provider.keyEnv] || "").trim();
    if (key) {
      return {
        id: provider.id,
        label: provider.label,
        key,
        base: provider.base,
        model: (env[provider.modelEnv] || "").trim() || provider.defaultModel,
      };
    }
  }
  return null;
}

/**
 * Kirim chat ke provider (streaming) dan agregasi tool_calls.
 * Mengembalikan { content, toolCalls: [{ id, name, arguments }] }.
 */
export async function streamChat({ provider, messages, tools, onDelta, signal }) {
  const body = {
    model: provider.model,
    messages,
    stream: true,
    temperature: 0.4,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${provider.key}`,
  };
  if (provider.id === "openrouter" || provider.id === "custom") {
    headers["HTTP-Referer"] = "http://localhost";
    headers["X-Title"] = "Jarvis Lokal";
  }

  const response = await fetch(`${provider.base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const hint =
      response.status === 401
        ? "API key ditolak. Cek lagi key provider-nya."
        : response.status === 429
          ? "Kuota gratis provider ini lagi habis. Coba lagi nanti atau pakai provider lain."
          : response.status === 404
            ? `Model "${provider.model}" nggak tersedia di provider ini. Ganti lewat env ${provider.id.toUpperCase()}_MODEL.`
            : "Provider menolak permintaan.";
    throw new Error(`${hint} (HTTP ${response.status}) ${text.slice(0, 300)}`);
  }

  if (!response.body) throw new Error("Provider nggak mengirim stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let chunk;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      if (chunk.error) {
        throw new Error(chunk.error.message || "Provider mengirim error di tengah stream.");
      }

      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content) {
        content += delta.content;
        onDelta?.(delta.content);
      }

      for (const call of delta.tool_calls || []) {
        const index = call.index ?? calls.length;
        if (!calls[index]) {
          calls[index] = { id: call.id || `call_${index}`, name: "", arguments: "" };
        }
        if (call.id) calls[index].id = call.id;
        if (call.function?.name) calls[index].name += call.function.name;
        if (call.function?.arguments) calls[index].arguments += call.function.arguments;
      }
    }
  }

  return {
    content,
    toolCalls: calls.filter(Boolean).filter((call) => call.name),
  };
}
