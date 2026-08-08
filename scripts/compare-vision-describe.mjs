// Vision-provider bake-off for the image-description feature (CLI).
//
// Sends the same images + prompt to every provider that has an API key set,
// then prints each description alongside latency, the provider's exact billed
// token counts, and the computed cost. This answers two open questions from
// IMAGE-DESCRIPTION-PRICING.md at once: output quality on real workload
// images, and real (not estimated) image-token counts per provider.
//
// Prefer judging in the browser? `node scripts/compare-vision-ui.mjs` serves
// the same comparison as a side-by-side web UI (with blind judging).
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
import {
  PROVIDERS,
  MEDIA_TYPES,
  isConfigured,
  describeImage,
} from "./lib/vision-compare-core.mjs";

function loadImage(path) {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  if (!mediaType) throw new Error(`unsupported image type: ${path}`);
  return { base64: readFileSync(path).toString("base64"), mediaType };
}

const imagePaths = process.argv.slice(2);
if (imagePaths.length === 0) {
  console.error("usage: node scripts/compare-vision-describe.mjs <image> [image...]");
  process.exit(1);
}

const active = PROVIDERS.filter(isConfigured);
const skipped = PROVIDERS.filter((p) => !isConfigured(p));
for (const p of skipped) console.error(`skipping ${p.name} (${p.keyEnv} not set)`);
if (active.length === 0) {
  console.error("no provider keys set — nothing to do");
  process.exit(1);
}

// totals[providerName] = { in, out, cost, lat[], calls, errors }
const totals = Object.fromEntries(
  active.map((p) => [p.name, { in: 0, out: 0, cost: 0, lat: [], calls: 0, errors: 0 }]),
);

for (const path of imagePaths) {
  const img = loadImage(path);
  console.log(`\n${"=".repeat(72)}\n# ${basename(path)}\n${"=".repeat(72)}`);

  // One image across all providers concurrently; images sequential so the
  // output stays readable.
  const results = await Promise.all(
    active.map(async (p) => {
      try {
        return { p, ...(await describeImage(p, img)) };
      } catch (err) {
        return { p, error: String(err.message || err), ms: 0 };
      }
    }),
  );

  for (const r of results) {
    const t = totals[r.p.name];
    t.calls += 1;
    console.log(`\n--- ${r.p.name} (${r.ms}ms) ---`);
    if (r.error) {
      t.errors += 1;
      console.log(`ERROR: ${r.error}`);
      continue;
    }
    t.lat.push(r.ms);
    t.in += r.inputTokens ?? 0;
    t.out += r.outputTokens ?? 0;
    t.cost += r.cost ?? 0;
    console.log(
      `tokens: ${r.inputTokens ?? "?"} in / ${r.outputTokens ?? "?"} out` +
        (r.cost != null ? `  cost: $${r.cost.toFixed(6)}` : ""),
    );
    console.log(r.text.trim());
  }
}

console.log(`\n${"=".repeat(72)}\n# Summary (${imagePaths.length} images)\n${"=".repeat(72)}`);
for (const [name, t] of Object.entries(totals)) {
  const ok = t.calls - t.errors;
  const avgIn = ok ? Math.round(t.in / ok) : 0;
  const lat = t.lat.length
    ? `${Math.min(...t.lat)}/${Math.round(t.lat.reduce((a, b) => a + b) / t.lat.length)}/${Math.max(...t.lat)}ms`
    : "—";
  console.log(
    `${name.padEnd(30)} avg ${String(avgIn).padStart(5)} in-tok/img  ` +
      `total $${t.cost.toFixed(5)}  ` +
      `est/visit(20): $${((t.cost / Math.max(ok, 1)) * 20).toFixed(4)}  ` +
      `lat min/avg/max ${lat}` +
      (t.errors ? `  (${t.errors} errors)` : ""),
  );
}
console.log(
  "\nJudge quality on: accuracy in dense scenes, hallucinated objects, " +
    "useful detail, tone. See IMAGE-DESCRIPTION-PRICING.md for the decision rule.",
);
