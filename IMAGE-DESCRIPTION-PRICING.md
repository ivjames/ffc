# Image Description Service — Provider Selection & Cost Model

Last updated: 2026-08-08. Continues the provider-selection handoff (realtime
image descriptions, ~20 images per user visit, 10k–100k visits/year →
200k–2M images/year). Batch processing and prompt caching are ruled out
(realtime UX; prompts too short to cache).

**Decision status: no provider committed.** The next gate is the quality
bake-off — run `scripts/compare-vision-describe.mjs` on ~5 real workload
images (see "Running the bake-off" below), then pick using the decision rule
at the bottom.

## ⚠️ What changed since the last analysis

The prior handoff's leading candidate is **gone**:

- **Gemini 2.0 Flash was shut down June 1, 2026** (deprecated Feb 18, 2026).
  The $0.075/$0.30 tier no longer exists.
- **The entire Gemini 2.5 family (Pro / Flash / Flash-Lite) shuts down
  October 16, 2026.** Gemini 2.5 Flash-Lite ($0.10/$0.40) is currently the
  cheapest live Gemini, but building on it now means a forced migration
  within ~2 months.
- Google's current replacements: **Gemini 3.1 Flash-Lite ($0.25/$1.50)** and
  Gemini 3 Flash ($0.50/$3.00).

Lesson to bake into the build: **cheap vision tiers live 12–18 months.**
Whatever we pick, the integration must be a thin adapter (model id, endpoint,
and $/MTok rates in config) so a provider swap is a config change plus a
re-run of the bake-off, not a rewrite. Don't chase the absolute floor at the
cost of a hard-coded dependency.

## Image tokenization per provider (verified formulas)

Per-image token counts differ by provider far more than ±30% — each has its
own encoding. For a ~1024×1024 photo:

| Provider | Formula | Tokens @ 1024×1024 | Tokens @ ≤768px |
|---|---|---|---|
| Anthropic (Haiku 4.5) | `w×h / 750` (downscale cap 1568px long edge) | ~1,400 | ~790 |
| Gemini (all) | 258 tokens per 768×768 tile; ≤384px both dims = 258 flat | 4 tiles = **1,032** | 1 tile = **258** |
| OpenAI (GPT-5 mini) | `ceil(w/32)×ceil(h/32)` patches (cap 1536), × **1.62** multiplier, billed at text rate | ~1,660 | ~940 |
| Qwen2.5-VL (SiliconFlow) | 28×28px per token; image resized into 256–1,280 token range (default caps) | ~1,280 (at cap) | ~750 |
| Llama 4 Scout (hosted) | Provider-dependent tiling — **not verified**; assume ~1,500 until measured | ~1,500? | ? |

Two practical consequences:

1. **Downscaling to ≤768px long edge before upload cuts Gemini image cost
   4×** (1 tile instead of 4) and roughly halves everyone else's. The hunt
   feature already downscales client-side to ≤1280px; for descriptions,
   768px is likely enough — test in the bake-off.
2. **Output tokens dominate on the mid-tier models.** At ~300 output tokens
   per description, Gemini 3.1 Flash-Lite spends 60%+ of the bill on output
   ($1.50/MTok out vs $0.25 in). Capping descriptions at ~150 tokens nearly
   halves the cost on those tiers.

## Per-image / per-visit costs (verified Aug 2026 rates)

Assumes 1024×1024 image (no downscale), ~100 prompt tokens, ~300 output
tokens. Exact token usage comes back in every API response — the harness
prints it, and production should meter it (same pattern as `hunt_scan`).

| Model | $/MTok in/out | Per image | Per visit (20) | Notes |
|---|---|---|---|---|
| Qwen2.5-VL-7B (SiliconFlow) | $0.05 / $0.05 | $0.00009 | $0.0018 | Absolute floor; 7B open-weights; third-party host |
| Llama 4 Scout (DeepInfra) | $0.08 / $0.30 | ~$0.0002 | ~$0.004 | Image tokens unverified |
| Gemini 2.5 Flash-Lite | $0.10 / $0.40 | $0.00023 | $0.0047 | **Shuts down Oct 16, 2026** — do not build on |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50 | $0.00073 | $0.0146 | Cheapest *durable* major-provider tier |
| GPT-5 mini | $0.25 / $2.00 | $0.00104 | $0.0208 | |
| Haiku 4.5 (baseline) | $1.00 / $5.00 | $0.00290 | $0.0580 | Already integrated (`server/lib/vision.js` pattern, key on droplet, metering exists) |

## Annual cost at the volume range

| Volume | Qwen2.5-VL | Gemini 3.1 Flash-Lite | GPT-5 mini | Haiku 4.5 |
|---|---|---|---|---|
| 10k visits (200k img) | ~$18 | ~$146 | ~$208 | ~$580 |
| 100k visits (2M img) | ~$175 | ~$1,460 | ~$2,080 | ~$5,800 |

With a 768px downscale + ~150-token description cap, every row roughly
halves (Gemini 3.1 Flash-Lite drops to ~$600/yr at 2M images; Haiku to
~$2.6k).

## Recommendation

The choice is really between three postures, gated by realistic volume:

1. **≤ ~20k visits/yr → just use Haiku 4.5.** At 200k images/yr the delta
   between Haiku and the cheapest durable tier is ~$400–560/yr — less than
   the ongoing cost of carrying a second provider key, a second billing
   relationship, and a second failure mode. The Anthropic integration,
   server-side key, spend metering, and Console spend-limit backstop already
   exist in this repo. Ship the feature on Haiku, meter it, and revisit when
   real volume data exists.
2. **Ramping toward 100k visits/yr → adapter + cheap tier.** The durable
   candidates are **Gemini 3.1 Flash-Lite** (major provider, ~$1.5k/yr at
   2M images) and **Qwen2.5-VL-7B on SiliconFlow** (~$175/yr, but a 7B model
   on a third-party host — quality and host-reliability risk). Pick via the
   bake-off; wire whichever wins behind the provider adapter.
3. **Do not** build on Gemini 2.5-anything (dead in October) and don't
   treat any cheap-tier choice as permanent — re-verify rates and model
   availability at build time and at each re-negotiation of volume.

Where the cheap tiers historically fall down is nuanced/dense-detail
description, not basic tagging — which is exactly what the bake-off
measures on our real images.

## Running the bake-off (handoff step 1)

```sh
# Keys: set whichever you have; providers without keys are skipped.
export ANTHROPIC_API_KEY=...      # Haiku 4.5 (quality reference)
export GEMINI_API_KEY=...         # Gemini 3.1 Flash-Lite (+ 2.5 Flash-Lite for reference)
export OPENAI_API_KEY=...         # GPT-5 mini
export SILICONFLOW_API_KEY=...    # Qwen2.5-VL-7B
export DEEPINFRA_API_KEY=...      # Llama 4 Scout

node scripts/compare-vision-describe.mjs photos/*.jpg

# Or judge in the browser (same providers/keys, side-by-side cards,
# optional blind judging — provider names/cost hidden until reveal):
node scripts/compare-vision-ui.mjs          # http://127.0.0.1:8787
# From a droplet, tunnel it: ssh -L 8787:127.0.0.1:8787 user@droplet
```

The script sends each image to every configured provider with the same
description prompt, and prints per call: the description, latency, the
provider's **exact billed token counts**, and the computed cost — so it
simultaneously answers handoff steps 1 (quality) and 2 (real image-token
counts per provider, replacing the estimates above). Edit `PROMPT` in the
script to match the real workload prompt before judging quality.

Judge on: accuracy on dense/cluttered scenes, hallucinated objects,
usefulness of detail (not length), and tone fit for a family venue.

## Sources (rates verified 2026-08-08)

- Gemini pricing & 2.0/2.5 shutdown dates: https://ai.google.dev/gemini-api/docs/pricing , https://ai.google.dev/gemini-api/docs/changelog
- Gemini image tiling (258 tok / 768×768 tile): https://ai.google.dev/gemini-api/docs/tokens
- OpenAI GPT-5 mini rates & 32px-patch formula: https://developers.openai.com/api/docs/pricing , https://developers.openai.com/api/docs/guides/images-vision
- SiliconFlow Qwen2.5-VL-7B: https://www.siliconflow.com/models/qwen-qwen2-5-vl-7b-instruct
- Llama 4 Scout provider rates: https://artificialanalysis.ai/models/llama-4-scout/providers
- Qwen2.5-VL tokenization (28×28px/token, 256–1,280 range): https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct
- Haiku 4.5 rates ($1/$5): Anthropic API docs (matches `HUNT-PRICING.md`)

Pricing shifts frequently — re-confirm every rate at time of build
(handoff step 3 stays open until then).
