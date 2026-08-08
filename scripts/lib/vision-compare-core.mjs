// Shared core for the vision-provider bake-off tools
// (scripts/compare-vision-describe.mjs CLI and scripts/compare-vision-ui.mjs
// web UI). Providers, HTTP callers, and cost math live here so both frontends
// stay in lockstep — see IMAGE-DESCRIPTION-PRICING.md for the decision this
// feeds.

// Edit to match the real workload prompt before judging quality (the UI also
// lets you override it per run).
export const DEFAULT_PROMPT =
  "Describe this photo in 2-4 sentences for a guest at a family " +
  "entertainment venue. Be specific about what is visible; do not guess " +
  "at anything you cannot see clearly.";

export const MAX_OUTPUT_TOKENS = 400;

// Rates are $/MTok (input, output) — verified 2026-08-08, re-confirm at
// build time. Model ids are config, not code: when a tier deprecates, update
// the row and re-run.
export const PROVIDERS = [
  {
    name: "haiku-4.5",
    kind: "anthropic",
    model: "claude-haiku-4-5",
    keyEnv: "ANTHROPIC_API_KEY",
    price: { in: 1.0, out: 5.0 },
  },
  {
    name: "gemini-3.1-flash-lite",
    kind: "gemini",
    model: "gemini-3.1-flash-lite",
    keyEnv: "GEMINI_API_KEY",
    price: { in: 0.25, out: 1.5 },
  },
  {
    // Reference only — the 2.5 family shuts down 2026-10-16. Do not ship on it.
    name: "gemini-2.5-flash-lite",
    kind: "gemini",
    model: "gemini-2.5-flash-lite",
    keyEnv: "GEMINI_API_KEY",
    price: { in: 0.1, out: 0.4 },
  },
  {
    name: "gpt-5-mini",
    kind: "openai",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    price: { in: 0.25, out: 2.0 },
  },
  {
    name: "qwen2.5-vl-7b (siliconflow)",
    kind: "openai",
    model: "Qwen/Qwen2.5-VL-7B-Instruct",
    baseUrl: "https://api.siliconflow.com/v1",
    keyEnv: "SILICONFLOW_API_KEY",
    price: { in: 0.05, out: 0.05 },
  },
  {
    name: "llama-4-scout (deepinfra)",
    kind: "openai",
    model: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    keyEnv: "DEEPINFRA_API_KEY",
    price: { in: 0.08, out: 0.3 },
  },
];

export const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export function isConfigured(provider) {
  return Boolean(process.env[provider.keyEnv]);
}

export function cost(provider, inTok, outTok) {
  if (inTok == null || outTok == null) return null;
  return (inTok * provider.price.in + outTok * provider.price.out) / 1e6;
}

async function post(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }
  return json;
}

// Each caller returns { text, inputTokens, outputTokens } with the
// provider-reported (billed) token counts.
async function callAnthropic(p, key, img, prompt) {
  const json = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    {
      model: p.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: img.mediaType, data: img.base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
  );
  return {
    text: json.content?.find((b) => b.type === "text")?.text ?? "",
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
}

async function callGemini(p, key, img, prompt) {
  const json = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`,
    { "x-goog-api-key": key },
    {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: img.mediaType, data: img.base64 } },
            { text: prompt },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
    },
  );
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts.map((x) => x.text ?? "").join(""),
    inputTokens: json.usageMetadata?.promptTokenCount ?? null,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
  };
}

async function callOpenAICompatible(p, key, img, prompt) {
  const json = await post(
    `${p.baseUrl}/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model: p.model,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    },
  );
  return {
    text: json.choices?.[0]?.message?.content ?? "",
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null,
  };
}

const CALLERS = {
  anthropic: callAnthropic,
  gemini: callGemini,
  openai: callOpenAICompatible,
};

/**
 * Run one image through one provider.
 *
 * @param {object} provider  An entry from PROVIDERS.
 * @param {{base64:string, mediaType:string}} img
 * @param {string} [prompt]
 * @returns {Promise<{text:string, inputTokens:number|null, outputTokens:number|null,
 *   ms:number, cost:number|null}>}
 */
export async function describeImage(provider, img, prompt = DEFAULT_PROMPT) {
  const key = process.env[provider.keyEnv];
  if (!key) throw new Error(`${provider.keyEnv} not set`);
  const started = Date.now();
  const r = await CALLERS[provider.kind](provider, key, img, prompt);
  return {
    ...r,
    ms: Date.now() - started,
    cost: cost(provider, r.inputTokens, r.outputTokens),
  };
}
