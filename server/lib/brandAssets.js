// Org branding asset uploads (MULTI-VENUE.md §6 bullet 3 — Master Control →
// Org → Branding). Operators upload a logo/icon FILE instead of pasting a URL;
// the stored file is served read-only from /api/brand-assets (express.static in
// app.js), and the returned URL goes into the matching org.branding field via
// the normal branding PATCH (this layer never touches org.branding).
//
// Validation is content-based, not filename/mediaType-trust-based: the bytes
// are sniffed (magic bytes) and only png/jpeg/webp/svg pass. PNG gets the full
// hand-rolled structural check (lib/pngInfo.js — signature, IHDR, IDAT, IEND;
// no image library), which also yields intrinsic dimensions: the two manifest
// icon kinds must be PNG at EXACTLY their declared size, or the per-tenant PWA
// manifest would lie to the installer. SVG is an XSS vector, so it gets a
// reject-on-suspicion textual check (like lib/svgSanitize.js, scoped to the
// constructs that execute: <script>, on{load,error}= handlers, javascript:
// URLs) — and app.js additionally serves every asset with nosniff + a sandbox
// CSP so even a direct navigation is inert.
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePng } from "./pngInfo.js";

// Brand marks are small; 1 MiB is generous for a logo/icon (the 512 icon is
// the biggest legitimate file and sits well under this).
export const MAX_BRAND_ASSET_BYTES = 1024 * 1024;

// Per-org byte budget across ALL kinds. Content-hashed files would otherwise
// accumulate forever (every distinct upload is a new immutable name); 5 MiB
// holds a full set of realistically-sized marks plus the prune grace window
// while keeping per-org disk bounded.
export const BRAND_ASSET_ORG_BUDGET_BYTES =
  Number(process.env.BRAND_ASSET_ORG_BUDGET_BYTES) > 0
    ? Number(process.env.BRAND_ASSET_ORG_BUDGET_BYTES)
    : 5 * 1024 * 1024;

// Prune grace window: the newest N files of each kind survive even when no
// branding URL references them — an uploaded-but-not-yet-saved URL must keep
// working while the operator finishes filling out the branding form.
const KEEP_NEWEST_PER_KIND = 2;

// Where uploaded assets live. On a deployed droplet this MUST be a dir that
// outlives deploys — bin/ffc ensures $APP_DIR/shared/brand-assets exists and
// documents pointing BRAND_ASSET_DIR at it in server/.env. The default (like
// the booth-sticker/photo dirs) is data/ under the server cwd, gitignored.
export const BRAND_ASSET_DIR =
  process.env.BRAND_ASSET_DIR || join(process.cwd(), "data", "brand-assets");

// One kind per branding URL field: <kind>Url ← /api/brand-assets/<org>/<kind>-….
export const BRAND_ASSET_KINDS = new Set([
  "logo",
  "logoBadge",
  "logoWordmark",
  "icon192",
  "icon512",
]);

// The manifest icon kinds: PNG only, at exactly this square size.
const ICON_SIDE = { icon192: 192, icon512: 512 };

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Executable constructs that make an SVG dangerous. Matching ANY rejects —
// reject-on-suspicion, never "clean" (the operator can re-export a plain SVG).
const SVG_DENY = [
  [/<script/i, "contains <script>"],
  [/onload\s*=/i, "contains an onload= handler"],
  [/onerror\s*=/i, "contains an onerror= handler"],
  [/javascript\s*:/i, "contains a javascript: URL"],
];

/**
 * Validate an uploaded brand asset's BYTES for a given kind: size cap, magic-
 * byte sniff (png/jpeg/webp/svg only), PNG structure + exact dimensions for
 * the icon kinds, and the SVG denylist.
 * @param {string} kind one of BRAND_ASSET_KINDS
 * @param {Buffer} bytes decoded upload
 * @returns {{ ext: string, mediaType: string } | { error: string, status: number }}
 */
export function validateBrandAsset(kind, bytes) {
  if (!BRAND_ASSET_KINDS.has(kind)) {
    return {
      error: "kind must be one of logo, logoBadge, logoWordmark, icon192, icon512",
      status: 400,
    };
  }
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { error: "empty file", status: 400 };
  }
  if (bytes.length > MAX_BRAND_ASSET_BYTES) {
    return { error: "file is too large (max 1 MiB)", status: 400 };
  }

  const iconSide = ICON_SIDE[kind];

  // PNG — full structural validation (shared hand-rolled parser; the IHDR it
  // reads is bytes 16-23, big-endian width/height) so icons get real dims.
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIG)) {
    const check = validatePng(bytes);
    if (!check.ok) return { error: `PNG rejected: ${check.reason}`, status: 400 };
    if (iconSide && (check.width !== iconSide || check.height !== iconSide)) {
      return {
        error: `${kind} must be exactly ${iconSide}×${iconSide} (got ${check.width}×${check.height})`,
        status: 400,
      };
    }
    return { ext: "png", mediaType: "image/png" };
  }
  // The manifest icons only accept PNG — anything else stops here.
  if (iconSide) {
    return { error: `${kind} must be a PNG (exactly ${iconSide}×${iconSide})`, status: 400 };
  }

  // JPEG magic (FF D8 FF).
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mediaType: "image/jpeg" };
  }
  // WebP: RIFF container with the WEBP fourcc.
  if (
    bytes.length >= 12 &&
    bytes.toString("latin1", 0, 4) === "RIFF" &&
    bytes.toString("latin1", 8, 12) === "WEBP"
  ) {
    return { ext: "webp", mediaType: "image/webp" };
  }
  // SVG: plain text (a NUL byte means a binary payload masquerading as text)
  // that starts with <svg or an <?xml declaration, minus the denylist above.
  if (!bytes.includes(0)) {
    const text = bytes.toString("utf8");
    const head = text.replace(/^﻿/, "").trimStart();
    if (/^<svg[\s>/]/i.test(head) || head.startsWith("<?xml")) {
      for (const [re, reason] of SVG_DENY) {
        if (re.test(text)) return { error: `SVG rejected: ${reason}`, status: 400 };
      }
      return { ext: "svg", mediaType: "image/svg+xml" };
    }
  }
  return { error: "unsupported file type (PNG, JPEG, WebP, or SVG only)", status: 400 };
}

// A stored asset name: <kind>-<sha256-12>.<ext>. Anything else in the org's
// dir was not written by storeBrandAsset and is never counted or pruned.
const ASSET_NAME_RE = /^([A-Za-z0-9]+)-[0-9a-f]{12}\.[a-z0-9]+$/;

/** Filenames in orgId's dir that the org's CURRENT branding URLs point at —
 *  these are live and must never be pruned, whatever their age. */
function referencedAssetNames(orgId, branding) {
  const prefix = `/api/brand-assets/${orgId}/`;
  const names = new Set();
  if (branding && typeof branding === "object" && !Array.isArray(branding)) {
    for (const value of Object.values(branding)) {
      if (typeof value === "string" && value.startsWith(prefix)) {
        names.add(value.slice(prefix.length));
      }
    }
  }
  return names;
}

/** The org's stored assets: [{ name, kind, size, mtimeMs }]. Missing dir = []. */
async function listOrgAssets(orgId) {
  const dir = join(BRAND_ASSET_DIR, orgId);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const files = [];
  for (const name of entries) {
    const m = ASSET_NAME_RE.exec(name);
    if (!m || !BRAND_ASSET_KINDS.has(m[1])) continue;
    const info = await stat(join(dir, name)).catch(() => null);
    if (!info || !info.isFile()) continue;
    files.push({ name, kind: m[1], size: info.size, mtimeMs: info.mtimeMs });
  }
  return files;
}

const totalBytes = (files) => files.reduce((sum, f) => sum + f.size, 0);

/**
 * Delete orgId's stored assets that are BOTH unreferenced by the org's current
 * branding AND outside the per-kind grace window (the KEEP_NEWEST_PER_KIND
 * newest by mtime). `incomingKind` — set when making room for an upload —
 * counts the about-to-land file as that kind's newest, so an org at its budget
 * can still rotate a mark. Returns the deleted filenames.
 */
export async function pruneBrandAssets(orgId, branding, { incomingKind } = {}) {
  const referenced = referencedAssetNames(orgId, branding);
  const byKind = new Map();
  for (const f of await listOrgAssets(orgId)) {
    if (!byKind.has(f.kind)) byKind.set(f.kind, []);
    byKind.get(f.kind).push(f);
  }
  const pruned = [];
  for (const [kind, group] of byKind) {
    group.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const keep = kind === incomingKind ? KEEP_NEWEST_PER_KIND - 1 : KEEP_NEWEST_PER_KIND;
    for (const f of group.slice(keep)) {
      if (referenced.has(f.name)) continue;
      await rm(join(BRAND_ASSET_DIR, orgId, f.name), { force: true });
      pruned.push(f.name);
    }
  }
  return pruned;
}

/**
 * Persist a validated asset as <BRAND_ASSET_DIR>/<orgId>/<kind>-<sha256-12>.<ext>
 * and return its public URL, or { error, status } when the org's byte budget
 * is exhausted. Content-hashed names make the file immutable — app.js serves
 * /api/brand-assets with a long immutable cache, and re-uploading identical
 * bytes lands on the same name (a harmless idempotent overwrite that consumes
 * no new budget). `branding` is the org's CURRENT stored branding: it defines
 * the referenced (undeletable) set for both the budget prune and the
 * prune-on-upload sweep of superseded files.
 * @returns {Promise<{ url: string, file: string } | { error: string, status: number }>}
 */
export async function storeBrandAsset(orgId, kind, bytes, ext, branding) {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `${kind}-${hash}.${ext}`;
  const dir = join(BRAND_ASSET_DIR, orgId);
  await mkdir(dir, { recursive: true });

  // Budget gate — only a genuinely NEW file adds bytes. Over budget → prune
  // superseded files first; reject only if that wasn't enough.
  let files = await listOrgAssets(orgId);
  if (!files.some((f) => f.name === file)) {
    if (totalBytes(files) + bytes.length > BRAND_ASSET_ORG_BUDGET_BYTES) {
      await pruneBrandAssets(orgId, branding, { incomingKind: kind });
      files = await listOrgAssets(orgId);
    }
    if (totalBytes(files) + bytes.length > BRAND_ASSET_ORG_BUDGET_BYTES) {
      const mib = (BRAND_ASSET_ORG_BUDGET_BYTES / (1024 * 1024)).toFixed(1).replace(/\.0$/, "");
      return {
        error: `this org's branding assets are over the ${mib} MiB storage budget — save the branding form (so unused uploads can be pruned) or remove some assets, then retry`,
        status: 400,
      };
    }
  }

  await writeFile(join(dir, file), bytes);

  // Prune-on-upload keeps storage bounded without a cron: superseded files
  // (unreferenced + outside the grace window) go now. Best-effort — the
  // upload itself already succeeded.
  try {
    await pruneBrandAssets(orgId, branding);
  } catch (err) {
    console.error("[brandAssets] prune failed:", err);
  }

  return { url: `/api/brand-assets/${orgId}/${file}`, file };
}
