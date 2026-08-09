// SVG sticker validation for venue-uploaded decorations (routes/admin/
// boothStickers.js). SVG is an XSS vector — it can carry <script>, event
// handlers, external references, and XXE entity payloads — so an uploaded file
// is NOT trusted just because an admin sent it. Defense in depth, three layers:
//
//   1. This validator REJECTS (does not try to "clean") any SVG containing a
//      dangerous construct — reject-on-suspicion is simpler and safer than
//      scrubbing, and staff can just re-export a plain SVG.
//   2. The file is only ever rendered as an <img>/canvas image, never inlined
//      into the DOM, so scripts can't execute even if one slipped through.
//   3. The serve endpoint sends hardened headers (CSP sandbox, nosniff), so
//      even direct navigation to the file is inert.
//
// We have no server-side SVG/XML parser (the app deliberately ships no image
// libs), so this is a conservative textual allowlist: it must look like a plain
// <svg> document and must not contain any construct on the denylist below.

// Generous for vector art, but bounded — a sticker is a small decoration.
export const MAX_SVG_BYTES = 512 * 1024;

// Each entry: [regex, human reason]. Matching ANY rejects the upload.
const DENY = [
  [/<\s*script\b/i, "contains a <script> element"],
  [/<\s*foreignObject\b/i, "contains a <foreignObject> element"],
  [/<\s*(a|iframe|embed|object|audio|video|link|meta|use)\b/i, "contains a disallowed element"],
  [/<!DOCTYPE/i, "contains a DOCTYPE (entity/XXE risk)"],
  [/<!ENTITY/i, "contains an ENTITY definition (XXE risk)"],
  [/\son\w+\s*=/i, "contains an inline event handler (on*=)"],
  [/javascript\s*:/i, "contains a javascript: URL"],
  // External/remote references of any flavor. Fragment refs (href="#id") are
  // allowed by the href check below; this catches url(http…), src=, and
  // xlink/href pointing off-document.
  [/url\(\s*['"]?\s*https?:/i, "references an external URL"],
  [/\bsrc\s*=/i, "contains a src attribute (external content)"],
];

// href / xlink:href must be same-document fragment refs only ("#thing"); any
// other value (http:, //, data:, file:, relative path) is rejected.
const HREF_RE = /\b(?:xlink:)?href\s*=\s*(['"])(.*?)\1/gi;

/**
 * Validate a candidate SVG sticker.
 * @param {Buffer} bytes raw uploaded file
 * @returns {{ ok: true, text: string, width: number, height: number }
 *          | { ok: false, reason: string }}
 */
export function validateSvgSticker(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, reason: "empty file" };
  }
  if (bytes.length > MAX_SVG_BYTES) {
    return { ok: false, reason: "file is too large" };
  }
  // A NUL byte means this isn't the plain-text SVG we require (and would let a
  // binary payload masquerade as one).
  if (bytes.includes(0)) return { ok: false, reason: "not a text SVG" };

  const text = bytes.toString("utf8");

  // Must be a plain SVG document: a root <svg …> after only leading whitespace
  // or an XML declaration. This also rejects HTML wrappers.
  const head = text.replace(/^﻿/, "").replace(/^\s+/, "");
  const body = head.startsWith("<?xml")
    ? head.slice(head.indexOf("?>") + 2).replace(/^\s+/, "")
    : head;
  if (!/^<svg[\s>]/i.test(body)) {
    return { ok: false, reason: "does not start with an <svg> root element" };
  }

  for (const [re, reason] of DENY) {
    if (re.test(text)) return { ok: false, reason };
  }

  // Every href must be an internal fragment reference.
  for (const m of text.matchAll(HREF_RE)) {
    const value = m[2].trim();
    if (!value.startsWith("#")) {
      return { ok: false, reason: "contains an external href reference" };
    }
  }

  const { width, height } = intrinsicSize(text);
  return { ok: true, text, width, height };
}

// Best-effort intrinsic size from width/height attributes or the viewBox, so
// the client can size the sticker with the right aspect ratio without parsing
// the SVG itself. Falls back to a square when nothing usable is present.
function intrinsicSize(text) {
  // Start at the <svg> element — an optional <?xml …?> declaration ends in its
  // own `>`, so slicing from the document start would read the declaration's
  // attributes (version/encoding), not the SVG's width/height/viewBox.
  const start = text.search(/<svg[\s>]/i);
  const from = start >= 0 ? text.slice(start) : text;
  const openTag = from.slice(0, from.indexOf(">") + 1);
  const num = (attr) => {
    const m = openTag.match(new RegExp(`\\b${attr}\\s*=\\s*(['"])\\s*([0-9.]+)`, "i"));
    return m ? Number.parseFloat(m[2]) : null;
  };
  let w = num("width");
  let h = num("height");
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
    const vb = openTag.match(/\bviewBox\s*=\s*(['"])\s*([-\d.\s]+)\1/i);
    if (vb) {
      const parts = vb[2].trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        w = parts[2];
        h = parts[3];
      }
    }
  }
  if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { width: 100, height: 100 };
  }
  // Round to integers (aspect is what matters), but never below 1 — a sub-0.5
  // dimension would round to 0 and later divide-by-zero the client's sizing.
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}
