// Vision-provider bake-off for the image-description feature.
//
// Sends the same images + prompt to every provider that has an API key set,
// then prints each description alongside latency, the provider's exact billed
// token counts, and the computed cost. This answers two open questions from
// IMAGE-DESCRIPTION-PRICING.md at once: output quality on real workload
// images, and real (not estimated) image-token counts per provider.
//
// Usage:
//   node scripts/compare-vision-describe.mjs img1.jpg img2.png ...
//
// Keys (set whichever you have — providers without a key are skipped):
//   ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY,
//   SILICONFLOW_API_KEY, DEEPINFRA_API_KEY
//
// No dependencies — plain fetch against each provider's HTTP API, so this
// runs from the repo root without touching package.json.

import { readFileSync } from "node:fs";
import { extname, basename } from "node:path";

// Edit to match the real workload prompt before judging quality.
const PROMPT =
  "Describe this photo in 2-4 sentences for a guest at a family " +
  "entertainment venue. Be specific about what is visible; do not guess " +
  "at anything you cannot see clearly.";

const MAX_OUTPUT_TOKENS = 400;

// Rates are $/MTok (input, output) — verified 2026-08-08, re-confirm at
// build time. Model ids are config, not code: when a tier deprecates, update
// the row and re-run.
const PROVIDERS = [
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

const MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function loadImage(path) {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`unsupported image type: ${path}`);
  return { base64: readFileSync(path).toString("base64"), mediaType };
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
async function callAnthropic(p, key, img) {
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
            { type: "text", text: PROMPT },
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

async function callGemini(p, key, img) {
  const json = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${p.model}:generateContent`,
    { "x-goog-api-key": key },
    {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: img.mediaType, data: img.base64 } },
            { text: PROMPT },
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

async function callOpenAICompatible(p, key, img) {
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
            { type: "text", text: PROMPT },
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

function cost(p, inTok, outTok) {
  if (inTok == null || outTok == null) return null;
  return (inTok * p.price.in + outTok * p.price.out) / 1e6;
}

const imagePaths = process.argv.slice(2);
if (imagePaths.length === 0) {
  console.error("usage: node scripts/compare-vision-describe.mjs <image> [image...]");
  process.exit(1);
}

const active = PROVIDERS.filter((p) => process.env[p.keyEnv]);
const skipped = PROVIDERS.filter((p) => !process.env[p.keyEnv]);
for (const p of skipped) console.error(`skipping ${p.name} (${p.keyEnv} not set)`);
if (active.length === 0) {
  console.error("no provider keys set — nothing to do");
  process.exit(1);
}

// totals[providerName] = { in, out, cost, ms, calls, errors }
const totals = Object.fromEntries(
  active.map((p) => [p.name, { in: 0, out: 0, cost: 0, ms: 0, calls: 0, errors: 0 }]),
);

for (const path of imagePaths) {
  const img = loadImage(path);
  console.log(`\n${"=".repeat(72)}\n# ${basename(path)}\n${"=".repeat(72)}`);

  // One image across all providers concurrently; images sequential so the
  // output stays readable.
  const results = await Promise.all(
    active.map(async (p) => {
      const started = Date.now();
      try {
        const r = await CALLERS[p.kind](p, process.env[p.keyEnv], img);
        return { p, ...r, ms: Date.now() - started };
      } catch (err) {
        return { p, error: String(err.message || err), ms: Date.now() - started };
      }
    }),
  );

  for (const r of results) {
    const t = totals[r.p.name];
    t.calls += 1;
    t.ms += r.ms;
    console.log(`\n--- ${r.p.name} (${r.ms}ms) ---`);
    if (r.error) {
      t.errors += 1;
      console.log(`ERROR: ${r.error}`);
      continue;
    }
    const c = cost(r.p, r.inputTokens, r.outputTokens);
    t.in += r.inputTokens ?? 0;
    t.out += r.outputTokens ?? 0;
    t.cost += c ?? 0;
    console.log(
      `tokens: ${r.inputTokens ?? "?"} in / ${r.outputTokens ?? "?"} out` +
        (c != null ? `  cost: $${c.toFixed(6)}` : ""),
    );
    console.log(r.text.trim());
  }
}

console.log(`\n${"=".repeat(72)}\n# Summary (${imagePaths.length} images)\n${"=".repeat(72)}`);
for (const [name, t] of Object.entries(totals)) {
  const ok = t.calls - t.errors;
  const avgIn = ok ? Math.round(t.in / ok) : 0;
  console.log(
    `${name.padEnd(30)} avg ${String(avgIn).padStart(5)} in-tok/img  ` +
      `total $${t.cost.toFixed(5)}  ` +
      `est/visit(20): $${((t.cost / Math.max(ok, 1)) * 20).toFixed(4)}  ` +
      `avg ${Math.round(t.ms / t.calls)}ms` +
      (t.errors ? `  (${t.errors} errors)` : ""),
  );
}
console.log(
  "\nJudge quality on: accuracy in dense scenes, hallucinated objects, " +
    "useful detail, tone. See IMAGE-DESCRIPTION-PRICING.md for the decision rule.",
);
