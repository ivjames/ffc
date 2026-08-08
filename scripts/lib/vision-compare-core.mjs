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

// Hunt-verify mode: the per-image prompt, kept close to the production
// wording in server/lib/vision.js so cheap-tier results transfer. __SUBJECT__
// is replaced per image (pre-populated by the Haiku pre-scan below, editable
// in the UI). Production uses schema-enforced structured output; here the
// JSON shape is just asked for in the prompt — how reliably each provider
// honors that is itself one of the things being compared.
export const HUNT_PROMPT_TEMPLATE =
  `You are the judge for a mini-golf scavenger hunt. A player submitted this ` +
  `photo claiming it shows: "__SUBJECT__".\n\n` +
  `Decide whether the target item is genuinely, clearly visible in the photo. ` +
  `Be reasonably lenient about angle, lighting, and partial views, but do NOT ` +
  `credit a find where the item is absent, ambiguous, or only implied.\n\n` +
  `Also judge anti-cheat: photo_of_photo is true if this looks like a picture ` +
  `of a screen, monitor, phone, or a printed photograph rather than a ` +
  `real-world scene.\n\n` +
  `Also moderate for a family entertainment venue: people posing or playing ` +
  `are welcome and never unsafe by themselves; unsafe is true only for ` +
  `genuinely inappropriate content.\n\n` +
  `Reply with ONLY this JSON object, no other text:\n` +
  `{"present": true|false, "confidence": 0.0-1.0, "reason": "one short ` +
  `sentence", "photo_of_photo": true|false, "unsafe": true|false}`;

// Pre-scan: one cheap Haiku call per image that names the likely hunt target
// so the UI can pre-fill each image's subject field.
export const PRESCAN_PROMPT =
  "This photo was taken for a scavenger hunt at a family entertainment " +
  "venue. Name the target item it was meant to capture in AT MOST three " +
  "words — like: giant pumpkin, windmill, red door. Reply with ONLY those " +
  "words: no article, no quotes, no punctuation, no explanation.";

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
  // Two incremental Gemini rungs above 3.1 Flash-Lite, to see where extra
  // spend buys quality (same key). Note 3.6 Flash's per-image cost lands
  // ABOVE Haiku 4.5 — it's here as a quality probe, not a candidate.
  {
    name: "gemini-3.5-flash-lite",
    kind: "gemini",
    model: "gemini-3.5-flash-lite",
    keyEnv: "GEMINI_API_KEY",
    price: { in: 0.3, out: 2.5 },
  },
  {
    name: "gemini-3.6-flash",
    kind: "gemini",
    model: "gemini-3.6-flash",
    keyEnv: "GEMINI_API_KEY",
    price: { in: 1.5, out: 7.5 },
  },
  {
    // Reasoning model: max_completion_tokens includes hidden reasoning
    // tokens, which at the shared 400 cap swallowed the whole budget and
    // returned empty replies. Minimal effort (a photo caption needs no
    // chain of thought — production Haiku runs without thinking too) plus
    // extra headroom.
    name: "gpt-5-mini",
    kind: "openai",
    model: "gpt-5-mini",
    baseUrl: "https://api.openai.com/v1",
    keyEnv: "OPENAI_API_KEY",
    price: { in: 0.25, out: 2.0 },
    maxTokens: 1024,
    extra: { reasoning_effort: "minimal" },
  },
  {
    // Qwen2.5-VL-7B ($0.05/$0.05) was delisted by SiliconFlow (API returns
    // 30003 "Model disabled") — this is its cheapest live VL successor.
    name: "qwen3-vl-8b (siliconflow)",
    kind: "openai",
    model: "Qwen/Qwen3-VL-8B-Instruct",
    baseUrl: "https://api.siliconflow.com/v1",
    keyEnv: "SILICONFLOW_API_KEY",
    price: { in: 0.18, out: 0.68 },
  },
  {
    name: "llama-4-scout (deepinfra)",
    kind: "openai",
    model: "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    keyEnv: "DEEPINFRA_API_KEY",
    price: { in: 0.08, out: 0.3 },
  },
  {
    // Vision is built into Small 4 (Pixtral retired) — currently the
    // cheapest major-provider vision tier on the board.
    name: "mistral-small-4",
    kind: "openai",
    model: "mistral-small-latest",
    baseUrl: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    price: { in: 0.1, out: 0.3 },
  },
  {
    // xAI's volume tier; verify the exact model id against console.x.ai if
    // the API rejects it.
    name: "grok-4.1-fast",
    kind: "openai",
    model: "grok-4-1-fast",
    baseUrl: "https://api.x.ai/v1",
    keyEnv: "XAI_API_KEY",
    price: { in: 0.2, out: 0.5 },
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
      max_completion_tokens: p.maxTokens || MAX_OUTPUT_TOKENS,
      ...(p.extra || {}),
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

/**
 * Name the likely hunt target in an image (Haiku pre-scan).
 * Returns describeImage's shape plus `subject` (cleaned one-line phrase).
 */
export async function prescanSubject(img) {
  const provider = PROVIDERS.find((p) => p.kind === "anthropic");
  const r = await describeImage(provider, img, PRESCAN_PROMPT);
  const subject = r.text
    .trim()
    .split("\n")[0]
    .replace(/^["'\s]+|["'.\s]+$/g, "");
  return { ...r, subject };
}
