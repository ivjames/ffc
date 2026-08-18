// Derive the two PWA manifest icons from an org's logo, in the browser.
//
// WHY THIS EXISTS
// Per-org app icons already work end to end: upload → server validation →
// org.branding.icon192Url/icon512Url → GET /api/manifest.webmanifest. What did
// not work is REUSING the logo an operator has already uploaded. The icon kinds
// are PNG at exactly 192×192 / 512×512 (server/lib/brandAssets.js) — deliberately,
// so the manifest cannot lie to the installer — while a logo is usually an SVG
// or some arbitrary-sized PNG. So an operator with a perfectly good logo still
// had to open an image editor and produce two exact-size squares by hand.
//
// WHY IN THE BROWSER
// The server has no image library on purpose: lib/pngInfo.js is a hand-rolled
// PNG structural reader written specifically to avoid one. Adding sharp/canvas
// server-side to resize a logo would undo that decision for a once-per-org
// convenience. A <canvas> in the admin SPA produces a real PNG at exactly the
// right size, and it uploads through the SAME endpoint with the SAME validation
// as a hand-made file — nothing downstream can tell the difference, and nothing
// downstream has to trust this code.

/** One manifest icon, and how much of the square its artwork may occupy. */
export type IconSpec = {
  kind: 'icon192' | 'icon512';
  side: number;
  /** Fraction of the side the artwork is allowed to fill. See below. */
  contentRatio: number;
};

// The two icons need DIFFERENT padding, because the manifest gives them
// different jobs (server/routes/manifest.js):
//
//   192 — any-purpose. Shown as-is, so it only needs enough margin not to look
//         cramped: artwork within the central 80%.
//
//   512 — declared BOTH any-purpose and `purpose: "maskable"`. Android may crop
//         a maskable icon to any shape inside the "safe zone": the circle of
//         radius 40% of the side, centred. The largest square that fits inside
//         that circle has side 2 × 0.4 ÷ √2 ≈ 0.5657 of the icon. Fill more
//         than that and a round launcher mask clips the logo — the exact bug
//         this constant exists to prevent, and one nobody sees until it ships
//         on somebody's phone.
export const ICON_SPECS: IconSpec[] = [
  { kind: 'icon192', side: 192, contentRatio: 0.8 },
  { kind: 'icon512', side: 512, contentRatio: (2 * 0.4) / Math.SQRT2 },
];

/**
 * Contain-fit `srcW × srcH` into the centred content box of a `side` square.
 * Pure, so the geometry is testable without a canvas.
 *
 * Never upscales past the content box, always preserves aspect, and centres on
 * both axes — a wordmark stays a wordmark rather than being stretched square.
 */
export function artworkBox(
  side: number,
  srcW: number,
  srcH: number,
  contentRatio: number,
): { x: number; y: number; w: number; h: number } {
  const box = side * contentRatio;
  // A zero/unknown intrinsic size (some SVGs report 0) would make the scale
  // Infinity or NaN; treat it as square so the icon is still produced.
  const safeW = srcW > 0 ? srcW : 1;
  const safeH = srcH > 0 ? srcH : 1;
  const scale = Math.min(box / safeW, box / safeH);
  const w = safeW * scale;
  const h = safeH * scale;
  return { x: (side - w) / 2, y: (side - h) / 2, w, h };
}

/** Load an image element for drawing, rejecting with a usable message. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin brand assets (/api/brand-assets/…) need no CORS dance; for a
    // pasted external URL this is the only chance to get an untainted canvas,
    // and it simply fails if that host sends no CORS header — which is the
    // honest outcome, since we cannot read those pixels either way.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error('Could not load that image. If it is on another domain, upload the file instead.'));
    img.src = url;
  });
}

/**
 * Render one icon: the background colour full-bleed, the logo contained and
 * centred on top. Returns a real PNG blob at exactly `spec.side` square.
 *
 * The background is painted rather than left transparent because a maskable
 * icon has no transparency on Android — the launcher fills it, and an
 * unpainted icon picks up whatever the platform chooses.
 */
export async function renderIcon(
  img: HTMLImageElement,
  spec: IconSpec,
  background: string,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = spec.side;
  canvas.height = spec.side;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot generate the icon (no 2D canvas).');

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, spec.side, spec.side);

  const { x, y, w, h } = artworkBox(spec.side, img.naturalWidth, img.naturalHeight, spec.contentRatio);
  ctx.drawImage(img, x, y, w, h);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png')).catch(
    () => null,
  );
  if (!blob) {
    // toBlob returns null / throws SecurityError on a tainted canvas — i.e. the
    // logo came from a host that sent no CORS header.
    throw new Error(
      'That logo is hosted on another domain and cannot be read here. Upload the logo file to this org first.',
    );
  }
  return blob;
}

/**
 * Both manifest icons from one logo URL, as Files ready for
 * `api.uploadBrandingAsset`. Named like a hand-made export so the stored
 * filename reads sensibly in the asset directory.
 */
export async function deriveAppIcons(
  logoUrl: string,
  background: string,
): Promise<{ kind: IconSpec['kind']; file: File }[]> {
  const img = await loadImage(logoUrl);
  const out = [];
  for (const spec of ICON_SPECS) {
    const blob = await renderIcon(img, spec, background);
    out.push({
      kind: spec.kind,
      file: new File([blob], `icon-${spec.side}.png`, { type: 'image/png' }),
    });
  }
  return out;
}
