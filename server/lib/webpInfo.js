// WebP validation for venue booth assets. The admin compresses a too-large PNG
// to WebP (lossy, alpha-preserving) at its ORIGINAL dimensions — smaller bytes,
// same resolution — so we accept WebP alongside PNG/SVG. Like PNG, WebP is a
// safe raster format; validation walks the RIFF chunk stream, requires a real
// decodable image frame (so an undecodable file is rejected), reads the
// intrinsic size, and bounds the decoded pixel count so it can't blow up to a
// huge RGBA bitmap when the booth renders it.
import { MAX_PNG_SIDE, MAX_PNG_PIXELS } from "./pngInfo.js";

export const MAX_WEBP_BYTES = 4 * 1024 * 1024;

function readUInt24LE(b, o) {
  return b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
}

/**
 * Validate a candidate WebP asset: RIFF/WEBP container, a well-formed chunk
 * stream containing a complete image frame (VP8 lossy, VP8L lossless, or a VP8X
 * extended header followed by a real frame), intrinsic dimensions, and bounded
 * decoded size.
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
  if (
    bytes.length < 20 ||
    bytes.toString("latin1", 0, 4) !== "RIFF" ||
    bytes.toString("latin1", 8, 12) !== "WEBP"
  ) {
    return { ok: false, reason: "not a WebP" };
  }

  let width = 0;
  let height = 0;
  let sawVP8X = false;
  let sawFrame = false; // a real VP8/VP8L image chunk was found + validated

  let off = 12;
  while (off + 8 <= bytes.length) {
    const cc = bytes.toString("latin1", off, off + 4);
    const size = bytes.readUInt32LE(off + 4);
    const p = off + 8; // payload start
    if (p + size > bytes.length) {
      return { ok: false, reason: "truncated WebP chunk" };
    }
    if (cc === "VP8X") {
      if (size < 10) return { ok: false, reason: "malformed VP8X header" };
      // flags(1) + reserved(3), then canvas width-1 / height-1 as 24-bit LE.
      width = readUInt24LE(bytes, p + 4) + 1;
      height = readUInt24LE(bytes, p + 7) + 1;
      sawVP8X = true;
    } else if (cc === "VP8L") {
      // Lossless frame: 0x2f signature, then 14-bit width-1 / height-1.
      if (size < 5 || bytes[p] !== 0x2f) {
        return { ok: false, reason: "malformed lossless frame" };
      }
      const bits = bytes.readUInt32LE(p + 1);
      if (!sawVP8X) {
        width = (bits & 0x3fff) + 1;
        height = ((bits >> 14) & 0x3fff) + 1;
      }
      sawFrame = true;
    } else if (cc === "VP8 ") {
      // Lossy key frame: 3-byte start code 0x9d 0x01 0x2a, then 14-bit w/h.
      if (size < 10 || bytes[p + 3] !== 0x9d || bytes[p + 4] !== 0x01 || bytes[p + 5] !== 0x2a) {
        return { ok: false, reason: "malformed lossy frame" };
      }
      if (!sawVP8X) {
        width = bytes.readUInt16LE(p + 6) & 0x3fff;
        height = bytes.readUInt16LE(p + 8) & 0x3fff;
      }
      sawFrame = true;
    }
    // RIFF chunks are padded to an even length.
    off = p + size + (size & 1);
  }

  if (!sawFrame) {
    return { ok: false, reason: "incomplete WebP (no image frame)" };
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
