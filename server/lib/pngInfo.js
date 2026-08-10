// PNG validation for venue booth assets (frames / watermarks / stickers).
// Unlike SVG, PNG is a safe raster format — it can't carry scripts or external
// references — so validation is just: it really is a PNG, it's within the size
// cap, and its intrinsic dimensions are readable (for aspect sizing). We serve
// it only as image data anyway (Content-Type image/png, nosniff).

// Frames can be detailed (portrait, ~2048px), so allow more headroom than SVG.
export const MAX_PNG_BYTES = 4 * 1024 * 1024;

// The 8-byte PNG signature.
const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Validate a candidate PNG asset and read its intrinsic size from the IHDR
 * chunk (which is required to be first).
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
  // Signature + a full IHDR: 8 (sig) + 4 (len) + 4 ("IHDR") + 13 (data) + 4 (crc).
  if (bytes.length < 8 + 8 + 13 || !bytes.subarray(0, 8).equals(SIG)) {
    return { ok: false, reason: "not a PNG" };
  }
  // First chunk must be IHDR; width/height are the first two 4-byte big-endian
  // fields of its 13-byte data (offsets 16 and 20 from the file start).
  if (bytes.toString("latin1", 12, 16) !== "IHDR") {
    return { ok: false, reason: "malformed PNG (no IHDR)" };
  }
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 20000 || height > 20000) {
    return { ok: false, reason: "unreasonable PNG dimensions" };
  }
  return { ok: true, width, height };
}
