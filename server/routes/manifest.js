// GET /api/manifest.webmanifest — per-tenant PWA manifest (MULTI-VENUE.md §3).
// index.html links here instead of shipping a baked-in manifest, so each
// client subdomain installs under its own name/colors/icons while sharing one
// static bundle. No tenant (no live orgs) serves the platform defaults —
// identical to the manifest the app shipped before orgs existed.
import { Router } from "express";
import { tenant } from "../lib/tenant.js";
import { resolveBranding } from "../lib/branding.js";

export const router = Router();

router.get("/", tenant(), (req, res) => {
  const b = resolveBranding(req.tenant?.org.branding ?? {});
  const manifest = {
    name: b.appName,
    short_name: b.shortName,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: b.themeColor,
    background_color: b.backgroundColor,
    icons: [
      { src: b.icon192Url, sizes: "192x192", type: "image/png" },
      { src: b.icon512Url, sizes: "512x512", type: "image/png" },
      // The 512 doubles as the maskable icon (contract §3).
      { src: b.icon512Url, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  // Spec MIME type — res.json() would stamp application/json instead.
  return res.set("Content-Type", "application/manifest+json").send(JSON.stringify(manifest));
});
