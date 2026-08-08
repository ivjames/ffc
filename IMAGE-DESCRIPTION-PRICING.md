# Image Description Service — Provider Selection & Cost Model

Last updated: 2026-08-08. Continues the provider-selection handoff (realtime
image descriptions, ~20 images per user visit, 10k–100k visits/year →
200k–2M images/year). Batch processing and prompt caching are ruled out
(realtime UX; prompts too short to cache).

**DECIDED 2026-08-08: Gemini 3.1 Flash-Lite** (`gemini-3.1-flash-lite`,
$0.25/$1.50 per MTok). See "The decision" below for ranking, evidence, and
revisit triggers. Re-verify the rate and the model's deprecation status at
build time — that instruction outlives every decision in this file.

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
| ~~Qwen2.5-VL-7B (SiliconFlow)~~ | ~~$0.05 / $0.05~~ | — | — | **Delisted** (API: "Model disabled", found in round-1 bake-off) |
| Llama 4 Scout (DeepInfra) | $0.08 / $0.30 | ~$0.0002 | ~$0.004 | Image tokens unverified; account needs credit |
| ~~Gemini 2.5 Flash-Lite~~ | ~~$0.10 / $0.40~~ | — | — | **Closed to new users** (API 404, found in round-1 bake-off); full shutdown Oct 16, 2026 |
| Mistral Small 4 | $0.10 / $0.30 | ~$0.00022 | ~$0.0044 | Cheapest major-provider tier; image tokenization unverified |
| Qwen3-VL-8B (SiliconFlow) | $0.18 / $0.68 | $0.00044 | $0.0089 | Cheapest live SiliconFlow VL; successor to the delisted 2.5-VL floor |
| Grok 4.1 Fast (xAI) | $0.20 / $0.50 | ~$0.00035 | ~$0.0069 | Volume tier; image tokenization unverified |
| Gemini 3.1 Flash-Lite | $0.25 / $1.50 | $0.00073 | $0.0146 | Cheapest *durable* major-provider tier |
| GPT-5 mini | $0.25 / $2.00 | $0.00104 | $0.0208 | reasoning_effort minimal (else reasoning eats the output cap) |
| Gemini 3.5 Flash-Lite | $0.30 / $2.50 | $0.00109 | $0.0218 | Next Lite generation — quality probe |
| Gemini 3.6 Flash | $1.50 / $7.50 | $0.00395 | $0.0790 | Full Flash tier — costs MORE than Haiku/image; quality probe only |
| Haiku 4.5 (baseline) | $1.00 / $5.00 | $0.00290 | $0.0580 | Already integrated (`server/lib/vision.js` pattern, key on droplet, metering exists) |

## Annual cost at the volume range

| Volume | Qwen3-VL-8B | Gemini 3.1 Flash-Lite | GPT-5 mini | Haiku 4.5 |
|---|---|---|---|---|
| 10k visits (200k img) | ~$88 | ~$146 | ~$208 | ~$580 |
| 100k visits (2M img) | ~$880 | ~$1,460 | ~$2,080 | ~$5,800 |

The 8× price-floor gap the original handoff chased is gone: with
Qwen2.5-VL delisted, the floor (Qwen3-VL-8B) and the durable major-provider
tier (Gemini 3.1 Flash-Lite) are now within ~1.7× of each other — which
strengthens the case for picking on quality, provider durability, and
integration simplicity rather than absolute price.

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
2. **Ramping toward 100k visits/yr → adapter + cheap tier.** The candidates
   are **Gemini 3.1 Flash-Lite** (major provider, ~$1.5k/yr at 2M images)
   and **Qwen3-VL-8B on SiliconFlow** (~$880/yr — an 8B model on a
   third-party host that has already delisted one model out from under this
   evaluation). At a ~1.7× price gap, Gemini 3.1 Flash-Lite wins unless the
   bake-off shows Qwen clearly better on quality.
3. **Do not** build on Gemini 2.5-anything (dead in October) and don't
   treat any cheap-tier choice as permanent — re-verify rates and model
   availability at build time and at each re-negotiation of volume.

Where the cheap tiers historically fall down is nuanced/dense-detail
description, not basic tagging — which is exactly what the bake-off
measures on our real images.

## The decision (2026-08-08)

Operator ranking after multi-round graded testing (ground-truth scrambled
sets + stored hunt photos, hunt-verify mode, steelmanned prompt with native
JSON enforcement, real 1280×960 dimensions):

1. **Gemini 3.1 Flash-Lite — selected.** $0.0082/visit measured (billed
   tokens, 20 images), ~$820/yr at the 100k-visit ceiling. Latency
   769/964/1598ms min/avg/max. Zero format errors. Cheapest durable
   major-provider tier; native responseSchema JSON enforcement.
2. **Gemini 3.5 Flash-Lite — runner-up.** Best latency profile on the board
   (716/931/1153ms), +35% cost over 3.1 with no measured quality edge.
   The natural migration target when 3.1 eventually deprecates.
3. **Haiku 4.5.** No format errors, fewer billed input tokens than Gemini
   at the same image size (Anthropic downscales internally), but 3.5× the
   cost ($0.0286/visit) and the worst latency tail (max 3.5s). Remains the
   production hunt verifier — that decision is separate and untouched.
4. **Gemini 3.6 Flash.** The quality probe: costs more per image than
   Haiku ($0.0479/visit) without a measured accuracy edge over the Lites
   on the graded set. Retired from future rounds.

Field notes: Mistral Small 4 ($0.10/$0.30) remains the untested cheaper
alternative if Google's pricing moves; SiliconFlow/Qwen was dropped on
operational grounds (delisted a model mid-evaluation, split-wallet billing
friction); Llama 4 Scout was never funded; GPT-5 Mini needed
reasoning_effort tuning to function and priced mid-pack.

**Revisit triggers:** Gemini 3.1 Flash-Lite deprecation notice (migrate to
the current Flash-Lite tier, re-run the bake-off as regression); any rate
change; false-credit/false-reject regression in production metering; volume
falling low enough (≲20k visits/yr) that consolidating on the
already-integrated Anthropic key beats carrying a second provider.

**Open optimization:** 768px send size — measured 4× image-token cut on
Gemini (one tile vs four). Run the A/B on the graded set (send-size toggle
in the bake-off UI) before wiring the feature's client-side downscale.

## Round-1 bake-off findings (2026-08-08, hunt-verify mode)

Run on a stored hunt photo (green doors). Quality: all three responding
models verdicted correctly with high confidence; one wrapped its JSON in
extra prose (flagged — a strike for a workload that needs machine-readable
verdicts). Infrastructure: **three of six providers failed for
availability reasons on day one** — Gemini 2.5 Flash-Lite 404s for new
users, SiliconFlow delisted Qwen2.5-VL-7B outright, DeepInfra requires
prepaid balance. The churn thesis needed no waiting period to confirm
itself.

## Running the bake-off (handoff step 1)

The tool is KEPT post-decision as the **vision vetting bench** for real
zones: source people-screened photos, label subjects with the descriptor,
and check verdicts against the production judge before items go live. The
lineup is trimmed to the two operational models (Haiku 4.5 = production
hunt judge, Gemini 3.1 Flash-Lite = selected descriptor); to re-audition a
model, add a row in `scripts/lib/vision-compare-core.mjs` — retired rows
and their per-model quirk fixes are in git history.

```sh
# Keys (server/.env on the droplet):
#   ANTHROPIC_API_KEY   Haiku 4.5 — production judge
#   GEMINI_API_KEY      Gemini 3.1 Flash-Lite — descriptor + selected model

# In Master Control (super_admin): log in, then open
#   https://<admin-domain>/api/admin/vision-bakeoff/ui

# Standalone fallback (no admin deploy needed):
node scripts/compare-vision-ui.mjs          # http://127.0.0.1:8787
HOST=0.0.0.0 BAKEOFF_TOKEN=$(openssl rand -hex 16) node scripts/compare-vision-ui.mjs
# then open http://<droplet-ip>:8787/?token=<that token>

# CLI (describe mode only):
node scripts/compare-vision-describe.mjs photos/*.jpg
```

The script sends each image to every configured provider with the same
description prompt, and prints per call: the description, latency, the
provider's **exact billed token counts**, and the computed cost — so it
simultaneously answers handoff steps 1 (quality) and 2 (real image-token
counts per provider, replacing the estimates above). Edit `PROMPT` in the
script to match the real workload prompt before judging quality.

Judge on: accuracy on dense/cluttered scenes, hallucinated objects,
usefulness of detail (not length), and tone fit for a family venue.

**Hunt-verify mode** (in the web UI): switches the comparison to the
production hunt workload — each image gets a subject ("a giant pumpkin"),
auto-named by a cheap Haiku pre-scan and editable per thumbnail, and every
provider is asked the `server/lib/vision.js`-style question: is the subject
present, is it a photo-of-a-photo, is it unsafe — as JSON. Cells render the
parsed verdict; a provider that can't return clean JSON gets flagged, which
is itself a disqualifying result for this workload. Include negative photos
(subject absent; a photo of a screen) — for a verifier, false positives and
anti-cheat misses matter more than prose quality.

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
