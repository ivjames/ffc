// PNG validation for venue booth assets (frames / watermarks / stickers).
// Unlike SVG, PNG is a safe raster format — it can't carry scripts or external
// references — so validation is just: it really is a PNG, it's within the size
// cap, and its intrinsic dimensions are readable (for aspect sizing). We serve
// it only as image data anyway (Content-Type image/png, nosniff).

// Frames can be detailed (portrait, ~2048px), so allow more headroom than SVG.
export const MAX_PNG_BYTES = 4 * 1024 * 1024;
// Decoded-size bounds (independent of the byte cap): a small, highly compressed
// PNG can still decode to an enormous RGBA bitmap and exhaust memory when the
// booth renders it — so cap BOTH each side and the total pixel count.
export const MAX_PNG_SIDE = 8000;
export const MAX_PNG_PIXELS = 20_000_000; // ~4472² / 6000×3333 — generous for real art

// The 8-byte PNG signature.
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validate a candidate PNG asset: signature, a well-formed chunk stream with a
 * proper IHDR first plus actual image data (IDAT) and a terminator (IEND) so
 * the accepted file is really a decodable PNG (a sig + IHDR alone renders
 * nowhere), and decoded-size bounds. Reads intrinsic width/height from IHDR.
 * @param {Buffer} bytes raw uploaded file
 * @returns {{ ok: true, width: number, height: number }
 *          | { ok: false, reason: string }}
 */
export function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, reason: "empty file" };
  }
  if (bytes.length > MAX_PNG_BYTES) {
    return { ok: false, reason: "file is too large" };
  }
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIG)) {
    return { ok: false, reason: "not a PNG" };
  }

  let off = 8;
  let width = 0;
  let height = 0;
  let sawIHDR = false;
  let sawIDAT = false;
  let sawIEND = false;
  while (off + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(off);
    const type = bytes.toString("latin1", off + 4, off + 8);
    const dataStart = off + 8;
    // Each chunk is length + type + data + 4-byte CRC; a length that runs past
    // the buffer means a truncated/forged file.
    if (dataStart + len + 4 > bytes.length) {
      return { ok: false, reason: "truncated or malformed PNG" };
    }
    if (!sawIHDR) {
      if (type !== "IHDR" || len !== 13) {
        return { ok: false, reason: "malformed PNG (no IHDR)" };
      }
      width = bytes.readUInt32BE(dataStart);
      height = bytes.readUInt32BE(dataStart + 4);
      sawIHDR = true;
    } else if (type === "IDAT" && len > 0) {
      sawIDAT = true;
    } else if (type === "IEND") {
      sawIEND = true;
      break;
    }
    off = dataStart + len + 4; // advance past the CRC
  }

  if (!sawIHDR) return { ok: false, reason: "malformed PNG (no IHDR)" };
  if (!sawIDAT || !sawIEND) {
    return { ok: false, reason: "incomplete PNG (no image data)" };
  }
  if (!width || !height) {
    return { ok: false, reason: "unreadable PNG dimensions" };
  }
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) {
    return { ok: false, reason: "PNG dimensions are too large" };
  }
  if (width * height > MAX_PNG_PIXELS) {
    return { ok: false, reason: "PNG resolution is too large" };
  }
  return { ok: true, width, height };
}
