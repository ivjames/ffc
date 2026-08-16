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
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { validatePng } from "./pngInfo.js";

// Brand marks are small; 1 MiB is generous for a logo/icon (the 512 icon is
// the biggest legitimate file and sits well under this).
export const MAX_BRAND_ASSET_BYTES = 1024 * 1024;

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

/**
 * Persist a validated asset as <BRAND_ASSET_DIR>/<orgId>/<kind>-<sha256-12>.<ext>
 * and return its public URL. Content-hashed names make the file immutable —
 * app.js serves /api/brand-assets with a long immutable cache, and re-uploading
 * identical bytes lands on the same name (a harmless idempotent overwrite).
 * @returns {Promise<{ url: string, file: string }>}
 */
export async function storeBrandAsset(orgId, kind, bytes, ext) {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  const file = `${kind}-${hash}.${ext}`;
  const dir = join(BRAND_ASSET_DIR, orgId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), bytes);
  return { url: `/api/brand-assets/${orgId}/${file}`, file };
}
