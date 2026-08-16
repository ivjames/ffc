// Venue logo, drawn into the arcade games' canvases.
//
// The brand asset ships as ONE white-on-transparent master (see srcFor()).
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

// Three cuts of the same mark. Which one fits is driven by how much room the
// placement has, because the moose is fine line art — see the aspect ratios and
// the minimum legible widths below (measured on a 340px game canvas):
//
//   full      1.93:1   needs ~140px  — badge over both lines of type
//   badge     1.27:1   needs ~92px   — the moose roundel alone
//   wordmark  5.52:1   needs ~80px   — BULLWINKLE'S + & FAMILY FUN CENTER
//
// Below those widths the badge's hairlines collapse into a smudge, so small
// signage (a marquee strip, a narrow backboard) wants the wordmark, not the
// full lockup shrunk down.
//
// The badge is a repaired cut: in the master the circle's bottom arc is fused
// with the wordmark's letters, so lifting the moose out on its own leaves the
// roundel visibly broken. The shipped asset restores that arc. The two breaks
// where the antlers cross the circle are deliberate — the antlers sit in front.
import { getBranding } from '../../lib/branding';

export type LogoVariant = 'full' | 'badge' | 'wordmark';

// Asset URLs come from the tenant branding (BRANDING_DEFAULTS carries the
// original /brand/*.png paths). Resolved per draw, not at import: branding
// hydrates from /api/content after the first frames.
function srcFor(variant: LogoVariant): string {
  const b = getBranding();
  return variant === 'badge' ? b.logoBadgeUrl : variant === 'wordmark' ? b.logoWordmarkUrl : b.logoUrl;
}

// Caches are keyed by URL (not variant) so a hydrate that swaps a logo URL
// reloads the asset — and clears a failure latched against the old URL.
const imgs = new Map<LogoVariant, HTMLImageElement>();
const loadedSrc = new Map<LogoVariant, string>();
const failed = new Set<string>();

/** Kick off the decode once, on first draw. Safe to call every frame. */
function ensureLoading(variant: LogoVariant): HTMLImageElement | null {
  const url = srcFor(variant);
  if (failed.has(url)) return null;
  const hit = imgs.get(variant);
  if (hit && loadedSrc.get(variant) === url) return hit;
  if (typeof Image === 'undefined') return null; // node (tests) — never loads
  const el = new Image();
  el.onerror = () => {
    // No logo deployed: latch the failure so we stop retrying every frame.
    failed.add(url);
    if (imgs.get(variant) === el) imgs.delete(variant);
  };
  el.src = url;
  imgs.set(variant, el);
  loadedSrc.set(variant, url);
  return el;
}

function decoded(variant: LogoVariant): HTMLImageElement | null {
  const el = ensureLoading(variant);
  return el && el.complete && el.naturalWidth > 0 ? el : null;
}

/** True once the given cut has decoded and can be drawn. */
export function logoReady(variant: LogoVariant = 'full'): boolean {
  return !!decoded(variant);
}

/** A cut's intrinsic aspect (width / height), or null until it decodes. */
export function logoAspect(variant: LogoVariant = 'full'): number | null {
  const el = decoded(variant);
  return el ? el.naturalWidth / el.naturalHeight : null;
}

// Recoloring is done on offscreen canvases keyed by color, built once each.
// Compositing per frame would mean an allocation + two draws every frame in
// every game; the games redraw at 60fps, so this cache is what makes the tint
// approach affordable.
const tinted = new Map<string, HTMLCanvasElement>();

function tintedCopy(el: HTMLImageElement, color: string): HTMLCanvasElement | null {
  // Keyed by the element's resolved URL so a branding swap can't serve a tint
  // built from the previous tenant's asset.
  const key = `${el.src}|${color}`;
  const hit = tinted.get(key);
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
  tinted.set(key, c);
  return c;
}

export type LogoOpts = {
  /** Which cut to draw. Default 'full'. */
  variant?: LogoVariant;
  /** Drawn width in canvas units; height follows the cut's aspect. */
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
  const variant = opts.variant ?? 'full';
  const el = decoded(variant);
  if (!el) return;

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
