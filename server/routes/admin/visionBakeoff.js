// Admin: TEMPORARY vision-provider bake-off for the image-description
// feature (IMAGE-DESCRIPTION-PRICING.md). Mounted at /api/admin/vision-bakeoff
// so the comparison page rides Master Control's HTTPS + login instead of an
// open port — log in to Master Control, then open
// /api/admin/vision-bakeoff/ui in the same browser.
//
// Remove this mount (index.js line + this file) once a provider is picked.
//
// super_admin only: every /describe call spends real money on whichever
// provider keys are in the server's environment (same env names as the CLI:
// ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, SILICONFLOW_API_KEY,
// DEEPINFRA_API_KEY). The page and callers live in scripts/lib/ — shared
// with scripts/compare-vision-{describe,ui}.mjs; deploys clone the whole
// repo, so the cross-directory import resolves on the droplet.
import { Router } from "express";
import express from "express";
import { isSuperAdmin } from "../../lib/adminAuth.js";
import {
  PROVIDERS,
  MEDIA_TYPES,
  DEFAULT_PROMPT,
  isConfigured,
  describeImage,
} from "../../../scripts/lib/vision-compare-core.mjs";
import { renderPage } from "../../../scripts/lib/vision-compare-page.mjs";

export const router = Router();

const ALLOWED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

// Page fetches relative to this mount; admin session cookie carries auth.
const PAGE = renderPage("/api/admin/vision-bakeoff");

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  next();
});

router.get("/ui", (req, res) => {
  res.type("html").send(PAGE);
});

router.get("/providers", (req, res) => {
  res.json({
    defaultPrompt: DEFAULT_PROMPT,
    providers: PROVIDERS.map((p) => ({
      name: p.name,
      model: p.model,
      keyEnv: p.keyEnv,
      configured: isConfigured(p),
      priceIn: p.price.in,
      priceOut: p.price.out,
    })),
  });
});

// Own parser: photos arrive as base64 JSON well past the app-wide 256kb cap
// (app.js skips this path, same arrangement as /api/hunt/verify).
router.post("/describe", express.json({ limit: "16mb" }), async (req, res) => {
  const provider = PROVIDERS.find((p) => p.name === req.body?.provider);
  if (!provider) return res.status(400).json({ error: "unknown provider" });
  if (!isConfigured(provider))
    return res.status(400).json({ error: `${provider.keyEnv} not set` });
  if (!ALLOWED_MEDIA_TYPES.has(req.body.mediaType))
    return res.status(400).json({ error: "unsupported media type" });
  if (typeof req.body.imageBase64 !== "string" || !req.body.imageBase64)
    return res.status(400).json({ error: "missing image" });

  const prompt =
    typeof req.body.prompt === "string" && req.body.prompt.trim()
      ? req.body.prompt
      : DEFAULT_PROMPT;
  try {
    const result = await describeImage(
      provider,
      { base64: req.body.imageBase64, mediaType: req.body.mediaType },
      prompt,
    );
    return res.json(result);
  } catch (err) {
    // Provider-side failure (bad key, rate limit, model gone) — report it in
    // the cell rather than failing the whole run.
    return res.status(502).json({ error: String(err.message || err) });
  }
});
