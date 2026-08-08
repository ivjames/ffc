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
// in the UI). Hardened for format obedience: exact-shape example, explicit
// prohibitions, and the format demand repeated at the very end (models weight
// the last lines heavily). Hunt calls ALSO switch on each provider's native
// JSON enforcement (see describeImage opts.json) — the prompt is the belt,
// the API mode is the suspenders, and the +prose flag catches what leaks.
export const HUNT_PROMPT_TEMPLATE =
  `You are the judge for a mini-golf scavenger hunt. A player submitted this ` +
  `photo claiming it shows: "__SUBJECT__".\n\n` +
  `Decide whether the target item is genuinely, clearly visible in the photo. ` +
  `Be reasonably lenient about angle, lighting, and partial views, but do NOT ` +
  `credit a find where the item is absent, ambiguous, or only implied.\n\n` +
  `Anti-cheat: photo_of_photo is true if this looks like a picture of a ` +
  `screen, monitor, phone, or a printed photograph rather than a real-world ` +
  `scene.\n\n` +
  `Moderation: people posing or playing are welcome and never unsafe by ` +
  `themselves; unsafe is true only for genuinely inappropriate content.\n\n` +
  `__DISTRACTORS__` +
  `Respond with a single JSON object and nothing else. Exact shape:\n` +
  `{"present":true,"confidence":0.95,"reason":"one short sentence",` +
  `"photo_of_photo":false,"unsafe":false}\n\n` +
  `Rules:\n` +
  `- present, photo_of_photo, unsafe: lowercase true or false\n` +
  `- confidence: a number between 0 and 1\n` +
  `- reason: one short plain-text sentence\n` +
  `- no markdown, no code fences, no preamble, no text after the JSON\n\n` +
  `Your entire reply must start with { and end with }.`;

// The verdict shape, for providers with schema-level enforcement
// (Anthropic output_config, Gemini responseSchema).
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: { type: "boolean" },
    confidence: { type: "number" },
    reason: { type: "string" },
    photo_of_photo: { type: "boolean" },
    unsafe: { type: "boolean" },
  },
  required: ["present", "confidence", "reason", "photo_of_photo", "unsafe"],
};

// Gemini's responseSchema dialect doesn't take additionalProperties.
function geminiSchema(schema) {
  return { type: "object", properties: schema.properties, required: schema.required };
}
const GEMINI_VERDICT_SCHEMA = geminiSchema(VERDICT_SCHEMA);

// Web-sourcing scan: one schema-enforced Haiku call that names the subject
// AND screens for people — sourced internet images are rejected when anyone
// is visible (test-data policy: no people in images sent to third parties).
export const SOURCE_SCAN_PROMPT =
  "Three tasks for this photo. 1) subject: name its single most prominent " +
  "object or feature in AT MOST three words, like a scavenger-hunt item " +
  "(giant pumpkin, windmill, red door) — no articles, and prefer something " +
  "DISTINCTIVE over generic scenery words (avoid: stone, tree, grass, sky, " +
  "path, wall) when anything distinctive exists. 2) people_present: true " +
  "if any person is visible, even partially or in the background; when " +
  "unsure, err toward true. 3) also_visible: up to 8 OTHER objects or " +
  "features clearly visible anywhere in the frame, each 1-3 words — " +
  "include mundane background items (rocks, fence, snow, bench); this list " +
  "is used to avoid falsely claiming an object is absent.";

export const SOURCE_SCAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: "string" },
    people_present: { type: "boolean" },
    also_visible: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "people_present", "also_visible"],
};

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
//
// Lineup: trimmed to the two operational models after the 2026-08-08
// provider decision (IMAGE-DESCRIPTION-PRICING.md) — Haiku is the
// production hunt judge, Gemini 3.1 Flash-Lite is the selected describe/
// descriptor model — since the tool's ongoing job is vetting sourced images
// for real zones, not provider comparison. To re-audition a model, add a
// row here ({name, label, kind, model, baseUrl?, keyEnv, price, extras});
// the retired rows (GPT-5 Mini, Qwen3-VL, Llama 4 Scout, Mistral Small 4,
// Grok 4.1 Fast, Gemini 3.5 Lite / 3.6 Flash) live in git history with
// their per-model quirk fixes.
export const PROVIDERS = [
  {
    name: "haiku-4.5",
    label: "Haiku 4.5",
    kind: "anthropic",
    model: "claude-haiku-4-5",
    keyEnv: "ANTHROPIC_API_KEY",
    price: { in: 1.0, out: 5.0 },
  },
  {
    name: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    kind: "gemini",
    model: "gemini-3.1-flash-lite",
    keyEnv: "GEMINI_API_KEY",
    price: { in: 0.25, out: 1.5 },
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
async function callAnthropic(p, key, img, prompt, opts) {
  const json = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    {
      model: p.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      // Same mechanism production vision.js uses — schema-guaranteed output.
      ...(opts?.json
        ? { output_config: { format: { type: "json_schema", schema: opts.schema || VERDICT_SCHEMA } } }
        : {}),
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

async function callGemini(p, key, img, prompt, opts) {
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
      generationConfig: {
        maxOutputTokens: p.maxTokens || MAX_OUTPUT_TOKENS,
        ...(p.geminiConfig || {}),
        ...(opts?.json
          ? {
              responseMimeType: "application/json",
              responseSchema: opts.schema ? geminiSchema(opts.schema) : GEMINI_VERDICT_SCHEMA,
            }
          : {}),
      },
    },
  );
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return {
    text: parts.map((x) => x.text ?? "").join(""),
    inputTokens: json.usageMetadata?.promptTokenCount ?? null,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
  };
}

async function callOpenAICompatible(p, key, img, prompt, opts) {
  const json = await post(
    `${p.baseUrl}/chat/completions`,
    { authorization: `Bearer ${key}` },
    {
      model: p.model,
      max_completion_tokens: p.maxTokens || MAX_OUTPUT_TOKENS,
      ...(p.extra || {}),
      // json_object is the widely-supported OpenAI-compatible mode (the
      // prompt carries the exact shape). A provider that rejects it will
      // error visibly in its cell — that itself is a finding.
      ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
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
export async function describeImage(provider, img, prompt = DEFAULT_PROMPT, opts = {}) {
  const key = process.env[provider.keyEnv];
  if (!key) throw new Error(`${provider.keyEnv} not set`);
  const started = Date.now();
  const r = await CALLERS[provider.kind](provider, key, img, prompt, opts);
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
/**
 * The model used for pre-scans and sourcing scans (the "descriptor").
 * BAKEOFF_SCAN_PROVIDER env picks by provider name; otherwise Gemini 3.1
 * Flash-Lite when its key is set (~7x cheaper per scan than Haiku), else
 * Haiku, else whatever is configured.
 */
export function scanProvider() {
  const wanted = process.env.BAKEOFF_SCAN_PROVIDER;
  if (wanted) {
    const p = PROVIDERS.find((x) => x.name === wanted);
    if (p && isConfigured(p)) return p;
  }
  const order = ["gemini-3.1-flash-lite", "haiku-4.5"];
  for (const name of order) {
    const p = PROVIDERS.find((x) => x.name === name);
    if (p && isConfigured(p)) return p;
  }
  return PROVIDERS.find(isConfigured) || PROVIDERS[0];
}

/**
 * Scan a sourced web image: subject phrase + people screening, schema-forced.
 * Returns { subject, peoplePresent, provider, ...usage }.
 */
export async function sourceScan(img) {
  const provider = scanProvider();
  const r = await describeImage(provider, img, SOURCE_SCAN_PROMPT, {
    json: true,
    schema: SOURCE_SCAN_SCHEMA,
  });
  const parsed = JSON.parse(r.text);
  return {
    ...r,
    subject: String(parsed.subject || "").trim(),
    peoplePresent: Boolean(parsed.people_present),
    alsoVisible: Array.isArray(parsed.also_visible)
      ? parsed.also_visible.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
      : [],
    provider: provider.name,
  };
}

export async function prescanSubject(img) {
  const provider = scanProvider();
  const r = await describeImage(provider, img, PRESCAN_PROMPT);
  const subject = r.text
    .trim()
    .split("\n")[0]
    .replace(/^["'\s]+|["'.\s]+$/g, "");
  return { ...r, subject, provider: provider.name };
}
