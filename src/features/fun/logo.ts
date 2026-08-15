// Venue logo, drawn into the arcade games' canvases.
//
// The brand asset ships as ONE white-on-transparent master (see LOGO_SRC).
// Every placement recolors it at draw time via `tint`, so there are no
// light/dark variant files to keep in sync — a white master composited through
// `source-in` becomes any color, and the games need both (white reads on the
// dark surfaces like center ice and the pinball playfield; a dark tint is
// needed on the light ones like the Pop-a-Shot backboard and the cream awnings).
//
// Rendering-only, exactly like fx.ts: nothing here touches game state, and a
// missing or still-decoding logo simply draws nothing rather than stalling a
// frame or shifting layout.
//
// Everything is lazily initialized. These modules are imported by game screens
// that the server-side tests load under a NODE environment, where `Image` and
// `document` don't exist — so no DOM global may be touched at import time.

const LOGO_SRC = '/brand/logo.png';

let img: HTMLImageElement | null = null;
let failed = false;

/** Kick off the decode once, on first draw. Safe to call every frame. */
function ensureLoading(): HTMLImageElement | null {
  if (failed) return null;
  if (img) return img;
  if (typeof Image === 'undefined') return null; // node (tests) — never loads
  const el = new Image();
  el.onerror = () => {
    // No logo deployed: latch the failure so we stop retrying every frame.
    failed = true;
    img = null;
  };
  el.src = LOGO_SRC;
  img = el;
  return img;
}

/** True once the master has decoded and can be drawn. */
export function logoReady(): boolean {
  const el = ensureLoading();
  return !!el && el.complete && el.naturalWidth > 0;
}

/** The master's intrinsic aspect (width / height), or null until it decodes. */
export function logoAspect(): number | null {
  const el = ensureLoading();
  if (!el || !el.complete || el.naturalWidth === 0) return null;
  return el.naturalWidth / el.naturalHeight;
}

// Recoloring is done on offscreen canvases keyed by color, built once each.
// Compositing per frame would mean an allocation + two draws every frame in
// every game; the games redraw at 60fps, so this cache is what makes the tint
// approach affordable.
const tinted = new Map<string, HTMLCanvasElement>();

function tintedCopy(el: HTMLImageElement, color: string): HTMLCanvasElement | null {
  const hit = tinted.get(color);
  if (hit) return hit;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = el.naturalWidth;
  c.height = el.naturalHeight;
  const cx = c.getContext('2d');
  if (!cx) return null;
  // Flood the color, then keep only where the master has coverage. This maps
  // the master's ALPHA onto the new color, so antialiased edges survive —
  // unlike a `multiply`/`difference` filter, which would also drag the
  // master's own white through and fringe the edges.
  cx.fillStyle = color;
  cx.fillRect(0, 0, c.width, c.height);
  cx.globalCompositeOperation = 'destination-in';
  cx.drawImage(el, 0, 0);
  tinted.set(color, c);
  return c;
}

export type LogoOpts = {
  /** Drawn width in canvas units; height follows the master's aspect. */
  width: number;
  /** Horizontal anchor. Default 'center'. */
  align?: 'left' | 'center' | 'right';
  /** Vertical anchor. Default 'middle'. */
  baseline?: 'top' | 'middle' | 'bottom';
  /** 0..1. Surface treatments (painted-on floors) want ~0.06–0.12. */
  alpha?: number;
  /** Any canvas color. Omit to draw the white master as-is. */
  tint?: string;
  /** Radians, about the anchor point. */
  rotate?: number;
};

/**
 * Draw the logo at (x, y). No-ops until the master has decoded, so the first
 * frames of a game render without it — no flash, no reflow, no stall.
 *
 * Callers own the layering: signage placements (a marquee, a backboard) draw
 * AFTER the scenery at full alpha, while painted-on surfaces (center ice, the
 * kart infield) draw BEFORE the vignette at low alpha so the scene's own
 * shading settles them in.
 */
export function drawLogo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  opts: LogoOpts,
): void {
  const el = ensureLoading();
  if (!el || !el.complete || el.naturalWidth === 0) return;

  const src = opts.tint ? tintedCopy(el, opts.tint) : el;
  if (!src) return;

  const w = opts.width;
  const h = w / (el.naturalWidth / el.naturalHeight);
  const dx = opts.align === 'left' ? 0 : opts.align === 'right' ? -w : -w / 2;
  const dy = opts.baseline === 'top' ? 0 : opts.baseline === 'bottom' ? -h : -h / 2;

  ctx.save();
  ctx.globalAlpha = opts.alpha ?? 1;
  ctx.translate(x, y);
  if (opts.rotate) ctx.rotate(opts.rotate);
  ctx.drawImage(src, dx, dy, w, h);
  ctx.restore();
}
