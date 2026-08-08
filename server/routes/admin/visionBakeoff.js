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
  prescanSubject,
} from "../../../scripts/lib/vision-compare-core.mjs";
import { renderPage } from "../../../scripts/lib/vision-compare-page.mjs";

export const router = Router();
export const publicRouter = Router();

const ALLOWED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

// "admin" auth mode: the page rides Master Control's login — session cookie
// on same-origin fetches, or the SPA's stored APP_TOKEN re-sent as the
// x-app-token header (a token-mode login can't attach headers to a plain
// page navigation, so the page must be reachable pre-auth and authenticate
// its own API calls instead).
const PAGE = renderPage("/api/admin/vision-bakeoff", "admin");

// Pre-auth like POST /login: the page is a static shell with no secrets in
// it — every data/spend endpoint below still requires super_admin.
publicRouter.get("/vision-bakeoff/ui", (req, res) => {
  // no-store: without it Safari heuristically caches this URL — including a
  // pre-deploy 401 body — and keeps serving the stale response after the fix.
  res.set("Cache-Control", "no-store").type("html").send(PAGE);
});

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  next();
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

// Hunt-mode pre-scan: one Haiku call that names the likely hunt target so
// the UI can pre-fill each image's subject field.
router.post("/prescan", express.json({ limit: "16mb" }), async (req, res) => {
  if (!ALLOWED_MEDIA_TYPES.has(req.body?.mediaType))
    return res.status(400).json({ error: "unsupported media type" });
  if (typeof req.body.imageBase64 !== "string" || !req.body.imageBase64)
    return res.status(400).json({ error: "missing image" });
  try {
    const result = await prescanSubject({
      base64: req.body.imageBase64,
      mediaType: req.body.mediaType,
    });
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

// Own parser: photos arrive as base64 JSON well past the app-wide 256kb cap
// (app.js skips this router's paths, same arrangement as /api/hunt/verify).
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
