// Admin: vision vetting bench, mounted at /api/admin/vision-bakeoff so it
// rides Master Control's HTTPS + login — log in, then open
// /api/admin/vision-bakeoff/ui.
//
// Born as the provider bake-off that produced the 2026-08-08 decision
// (IMAGE-DESCRIPTION-PRICING.md); KEPT as the standing tool for vetting
// sourced images for real zones: source people-screened photos, label
// subjects with the descriptor (Gemini 3.1 Flash-Lite), and check verdicts
// against the production hunt judge (Haiku) before items go live. The
// lineup is trimmed to those two models — re-audition others by adding
// rows in scripts/lib/vision-compare-core.mjs.
//
// super_admin only: every /describe and /prescan call spends real money on
// the provider keys in the server's environment (ANTHROPIC_API_KEY,
// GEMINI_API_KEY). The page and callers live in scripts/lib/ — shared with
// scripts/compare-vision-{describe,ui}.mjs; deploys clone the whole repo,
// so the cross-directory import resolves on the droplet.
import { Router } from "express";
import express from "express";
import { isSuperAdmin } from "../../lib/adminAuth.js";
import { isScreeningConfigured, screenItemImage } from "../../lib/itemImageScreen.js";
import {
  PROVIDERS,
  MEDIA_TYPES,
  DEFAULT_PROMPT,
  isConfigured,
  describeImage,
  prescanSubject,
} from "../../../scripts/lib/vision-compare-core.mjs";
import { renderPage } from "../../../scripts/lib/vision-compare-page.mjs";
import {
  listDataset,
  addDatasetImage,
  getDatasetImage,
  updateSubject,
  removeDatasetImage,
  clearDataset,
  appendRun,
  clearRuns,
  runsSummary,
  prescanCacheGet,
  prescanCachePut,
  scrambleDataset,
} from "../../../scripts/lib/vision-compare-store.mjs";
import { sourceImagesFromWeb } from "../../../scripts/lib/vision-compare-source.mjs";

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
      label: p.label || p.name,
      model: p.model,
      keyEnv: p.keyEnv,
      configured: isConfigured(p),
      priceIn: p.price.in,
      priceOut: p.price.out,
    })),
  });
});

// --- Persistent test dataset + run history (BAKEOFF_DATA_DIR on disk) ------
// The operator accumulates a reusable image set and every model call's
// result across many test rounds, and clears either at will from the page.
const smallJson = express.json({ limit: "1mb" });

router.get("/dataset", (req, res) => res.json({ images: listDataset() }));

// Every image entering the dataset is people-screened HERE, server-side,
// before it is stored (same seam as hunt-item vetting uploads —
// routes/admin/huntItems.js): the CLAUDE.md test-data policy says bench
// images must not contain people because they get sent to third-party
// providers, and the page's client-side filters are a UX nicety, not the
// enforcement. Anyone visible → nothing stored. Because /prescan and
// /describe below only accept dataset ids, this is the single choke point
// through which all bench bytes reach a provider. The screen's billed
// tokens + cost ride back on the response (`scan`) per the operator policy.
router.post("/dataset", express.json({ limit: "16mb" }), async (req, res) => {
  if (!ALLOWED_MEDIA_TYPES.has(req.body?.mediaType))
    return res.status(400).json({ error: "unsupported media type" });
  if (typeof req.body.imageBase64 !== "string" || !req.body.imageBase64)
    return res.status(400).json({ error: "missing image" });
  // No screen, no add — refuse rather than store unscreened test data.
  if (!isScreeningConfigured())
    return res.status(503).json({
      error: "image screening is not configured on the server (no vision API key)",
    });
  let scan;
  try {
    scan = await screenItemImage({
      imageBase64: req.body.imageBase64,
      mediaType: req.body.mediaType,
    });
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
  const scanOut = {
    provider: scan.provider,
    inputTokens: scan.inputTokens,
    outputTokens: scan.outputTokens,
    cost: scan.cost,
  };
  if (scan.peoplePresent) {
    return res.status(400).json({
      error: "people are visible in this image — bench images must be people-free",
      peoplePresent: true,
      scan: scanOut,
    });
  }
  const entry = addDatasetImage({
    name: req.body.name,
    subject: req.body.subject,
    mediaType: req.body.mediaType,
    base64: req.body.imageBase64,
  });
  return res.json({ ...entry, scan: scanOut });
});

// Source people-free web images (Picsum + Haiku subject/people scan).
router.post("/dataset/source", smallJson, async (req, res) => {
  try {
    return res.json(await sourceImagesFromWeb(req.body?.count));
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

// Reset subjects to truth, then mismatch a random half (expected=false).
router.post("/dataset/scramble", (req, res) => {
  return res.json(scrambleDataset());
});

router.get("/dataset/:id/image", (req, res) => {
  const found = getDatasetImage(req.params.id);
  if (!found) return res.status(404).json({ error: "not found" });
  res.set("Content-Type", found.entry.mediaType);
  res.set("Cache-Control", "private, max-age=300");
  return res.send(found.bytes);
});

router.post("/dataset/:id/subject", smallJson, (req, res) => {
  const entry = updateSubject(req.params.id, req.body?.subject);
  if (!entry) return res.status(404).json({ error: "not found" });
  return res.json(entry);
});

router.delete("/dataset/:id", (req, res) => {
  if (!removeDatasetImage(req.params.id))
    return res.status(404).json({ error: "not found" });
  return res.json({ ok: true });
});

router.delete("/dataset", (req, res) => {
  clearDataset();
  return res.json({ ok: true });
});

router.post("/runs", smallJson, (req, res) => {
  appendRun(req.body || {});
  return res.json({ ok: true });
});

router.get("/runs/summary", (req, res) => res.json(runsSummary()));

router.delete("/runs", (req, res) => {
  clearRuns();
  return res.json({ ok: true });
});

// Only screened bytes leave the building: /prescan and /describe refuse raw
// image payloads and take a dataset `imageId` instead, reading the STORED
// bytes for the provider call. Ingestion (POST /dataset above, or the
// sourcing flow's own scan) is where screening happened, so a request can
// only ship what already passed it — a modified client posting its own
// base64 gets a 400, not a provider call. (The local CLI bench keeps the
// raw-bytes contract for operator-local files; this guard is the admin
// mount's, where the invariant lives.)
function datasetImageOr400(req, res) {
  const id = req.body?.imageId;
  const found = typeof id === "string" && id ? getDatasetImage(id) : null;
  if (!found) {
    res.status(400).json({
      error:
        "imageId of a stored dataset image is required — raw image bytes are not accepted here; add the image to the dataset (people-screened) first",
    });
    return null;
  }
  return found;
}

// Hunt-mode pre-scan: one Haiku call that names the likely hunt target so
// the UI can pre-fill each image's subject field.
router.post("/prescan", smallJson, async (req, res) => {
  const found = datasetImageOr400(req, res);
  if (!found) return;
  const base64 = found.bytes.toString("base64");
  // Content-hash cache: an image ever scanned before costs nothing again.
  // Token fields stay null on a hit so the client's burn ticker skips it.
  const hit = prescanCacheGet(base64);
  if (hit) return res.json({ subject: hit.subject, cached: true });
  try {
    const result = await prescanSubject({
      base64,
      mediaType: found.entry.mediaType,
    });
    prescanCachePut(base64, result.subject);
    return res.json(result);
  } catch (err) {
    return res.status(502).json({ error: String(err.message || err) });
  }
});

// Dataset-id only, like /prescan — the stored (screened) bytes are what the
// provider sees, so the page's client-side downscale toggle doesn't apply on
// this mount (the UI disables it in admin mode; images go full-size).
router.post("/describe", smallJson, async (req, res) => {
  const provider = PROVIDERS.find((p) => p.name === req.body?.provider);
  if (!provider) return res.status(400).json({ error: "unknown provider" });
  if (!isConfigured(provider))
    return res.status(400).json({ error: `${provider.keyEnv} not set` });
  const found = datasetImageOr400(req, res);
  if (!found) return;

  const prompt =
    typeof req.body.prompt === "string" && req.body.prompt.trim()
      ? req.body.prompt
      : DEFAULT_PROMPT;
  try {
    const result = await describeImage(
      provider,
      { base64: found.bytes.toString("base64"), mediaType: found.entry.mediaType },
      prompt,
      { json: req.body.json === true },
    );
    return res.json(result);
  } catch (err) {
    // Provider-side failure (bad key, rate limit, model gone) — report it in
    // the cell rather than failing the whole run.
    return res.status(502).json({ error: String(err.message || err) });
  }
});
