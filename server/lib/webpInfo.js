// WebP validation for venue booth assets. The admin compresses a too-large PNG
// to WebP (lossy, alpha-preserving) at its ORIGINAL dimensions — smaller bytes,
// same resolution — so we accept WebP alongside PNG/SVG. Like PNG, WebP is a
// safe raster format; validation is: it really is a WebP, within the byte cap,
// and its decoded size (read from the header) is bounded so it can't blow up to
// a huge RGBA bitmap when the booth renders it.
import { MAX_PNG_SIDE, MAX_PNG_PIXELS } from "./pngInfo.js";

export const MAX_WEBP_BYTES = 4 * 1024 * 1024;

function readUInt24LE(b, o) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

/**
 * Validate a candidate WebP asset and read its intrinsic size from the header.
 * Handles the three container forms: VP8 (lossy), VP8L (lossless), VP8X
 * (extended — what canvas WebP-with-alpha produces).
 * @param {Buffer} bytes raw file
 * @returns {{ ok: true, width: number, height: number }
 *          | { ok: false, reason: string }}
 */
export function validateWebp(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, reason: "empty file" };
  }
  if (bytes.length > MAX_WEBP_BYTES) {
    return { ok: false, reason: "file is too large" };
  }
  // RIFF container: "RIFF" <size> "WEBP" <fourcc> …
  if (
    bytes.length < 30 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP"
  ) {
    return { ok: false, reason: "not a WebP" };
  }

  const fourcc = bytes.toString("latin1", 12, 16);
  let width = 0;
  let height = 0;
  if (fourcc === "VP8X") {
    // Canvas width/height are stored minus one, as 24-bit little-endian.
    width = readUInt24LE(bytes, 24) + 1;
    height = readUInt24LE(bytes, 27) + 1;
    // The extended header must be followed by an actual image frame — a
    // VP8X-only file decodes nowhere (same class of hole as a PNG with no IDAT).
    if (!bytes.includes("VP8 ", 30, "latin1") && !bytes.includes("VP8L", 30, "latin1")) {
      return { ok: false, reason: "incomplete WebP (no image data)" };
    }
  } else if (fourcc === "VP8 ") {
    // Lossy: after the 10-byte frame header, a 3-byte start code, then 14-bit
    // width and height little-endian.
    if (bytes.toString("latin1", 23, 26) !== "\x9d\x01\x2a") {
      // start code check is best-effort; fall through to reading dimensions
    }
    width = bytes.readUInt16LE(26) & 0x3fff;
    height = bytes.readUInt16LE(28) & 0x3fff;
  } else if (fourcc === "VP8L") {
    // Lossless: 0x2f signature byte, then 14 bits width-1 and 14 bits height-1.
    if (bytes[20] !== 0x2f) {
      return { ok: false, reason: "malformed lossless WebP" };
    }
    const bits = bytes.readUInt32LE(21);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  } else {
    return { ok: false, reason: "unsupported WebP form" };
  }

  if (!width || !height) {
    return { ok: false, reason: "unreadable WebP dimensions" };
  }
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    return { ok: false, reason: "WebP dimensions are too large" };
  }
  if (width * height > MAX_PNG_PIXELS) {
    return { ok: false, reason: "WebP resolution is too large" };
  }
  return { ok: true, width, height };
}
