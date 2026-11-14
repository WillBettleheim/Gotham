// Non-Claude residents. All of these speak the OpenAI-style /chat/completions format.
// Model IDs change often (especially free ones), so every one can be overridden in .env.

export const PROVIDERS = {
  gemini: {
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",           // free key: https://aistudio.google.com/apikey
    modelEnv: "GEMINI_MODEL",
    model: "gemini-3.5-flash",
    extra: { reasoning_effort: "low" },
  },
  gpt: {
    // Uses OpenAI directly if OPENAI_API_KEY is set, otherwise OpenAI's open GPT-OSS on Groq's free tier.
    name: "OpenAI GPT",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    modelEnv: "OPENAI_MODEL",
    model: "gpt-5-mini",
    alt: { baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", modelEnv: "GROQ_GPT_MODEL", model: "openai/gpt-oss-120b", extra: { reasoning_effort: "low" } },
  },
  llama: {
    name: "Meta Llama",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",             // free key: https://console.groq.com/keys
    modelEnv: "GROQ_LLAMA_MODEL",
    model: "llama-3.3-70b-versatile",
  },
  mistral: {
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",          // free "Experiment" plan: https://console.mistral.ai
    modelEnv: "MISTRAL_MODEL",
    model: "mistral-small-latest",
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    keyEnv: "DEEPSEEK_API_KEY",         // very cheap pay-as-you-go: https://platform.deepseek.com
    modelEnv: "DEEPSEEK_MODEL",
    model: "deepseek-chat",
  },
};

// Pick the first configuration whose key is present.
export function resolveProvider(key) {
  const p = PROVIDERS[key];
  if (!p) return null;
  for (const c of [p, p.alt].filter(Boolean)) {
    const apiKey = process.env[c.keyEnv];
    if (apiKey) return { baseUrl: c.baseUrl, apiKey, model: process.env[c.modelEnv] || c.model, extra: c.extra ?? {}, via: c.baseUrl };
  }
  return null;
}

export async function chatCompletion(cfg, system, user, maxTokens) {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
      ...cfg.extra,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    text: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim() || null,
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
  };
}
