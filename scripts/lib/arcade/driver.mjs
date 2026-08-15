// Arcade driver — the browser-side half of the arcade bot. Wraps one Playwright
// page that has an arcade mini-game open, and gives a game policy the four
// things it needs to actually play:
//
//   1. LOGICAL COORDINATES. Every game in src/features/fun renders into a fixed
//      logical field (its own W×H) and maps pointer events back through
//      getBoundingClientRect() — see useFitCanvas.ts, which deliberately keeps
//      the element's aspect ratio so that mapping stays exact. So a policy can
//      reason purely in the game's own units and let toClient() place the real
//      pointer. Off-by-one in this mapping is the difference between a 100 and
//      a gutter, so it is the one thing worth getting exactly right.
//   2. GESTURES. swipe() and tap() drive the real mouse through Playwright, so
//      the events React sees are genuine browser input, not synthesized DOM
//      events. Swipes interpolate intermediate moves because the games read the
//      drag delta from onPointerMove, not from the up-point.
//   3. EYES. probe() reads the canvas back with getImageData, which is how the
//      timing games are played: their sweeping guide lives in a React ref we
//      cannot reach from outside, but it is painted every frame, so the bot
//      locates it the same way a player does — by looking at it.
//   4. THE PAGE CLOCK. pageNow() reads performance.now() inside the page, the
//      same clock the games' rAF loops use, so predicted tap times are in the
//      game's own frame of reference rather than Node's.
//
// The driver knows nothing about any particular game; everything game-specific
// lives in ./games/*.mjs.

/** Playwright's mouse is a single global cursor — serialize gestures per page. */
export class ArcadeDriver {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {{ W: number, H: number }} field logical field size for this game
   */
  constructor(page, field) {
    this.page = page;
    this.W = field.W;
    this.H = field.H;
    this.box = null; // canvas bounding box in client coords
  }

  /** Wait for the game canvas and cache its on-screen box. */
  async attach({ timeout = 15_000 } = {}) {
    const canvas = this.page.locator('canvas').first();
    await canvas.waitFor({ state: 'visible', timeout });
    // One frame of settle: useFitCanvas sizes the element from a ResizeObserver,
    // so the first box we could read may still be the pre-fit size.
    await this.page.waitForTimeout(120);
    this.box = await canvas.boundingBox();
    if (!this.box || this.box.width < 2) throw new Error('arcade: canvas has no box');
    return this.box;
  }

  /** Re-read the canvas box (after an orientation/layout change). */
  async refit() {
    this.box = await this.page.locator('canvas').first().boundingBox();
    return this.box;
  }

  /** Logical field point → client (viewport) point. */
  toClient(x, y) {
    const b = this.box;
    return { x: b.x + (x / this.W) * b.width, y: b.y + (y / this.H) * b.height };
  }

  /** Logical length → client pixels (uniform scale; aspect ratio is preserved). */
  scale(v) {
    return (v / this.W) * this.box.width;
  }

  /** performance.now() *inside the page* — the clock the game's rAF loop uses. */
  async pageNow() {
    return this.page.evaluate(() => performance.now());
  }

  /**
   * Tap at a logical point.
   * Games that only bind onPointerDown (the timing games) fire on the press, so
   * the down-edge is what has to land at the right moment.
   */
  async tap(x, y) {
    const p = this.toClient(x, y);
    await this.page.mouse.move(p.x, p.y);
    await this.page.mouse.down();
    await this.page.mouse.up();
  }

  /**
   * Drag from a logical point by a logical delta, which is what the swipe games
   * actually read (launchVelocity() takes the delta; the press point is free).
   * `steps` intermediate moves so onPointerMove sees the full delta before the
   * release — a single jump can be coalesced by the browser and lose the drag.
   */
  async swipe(fromX, fromY, dx, dy, { steps = 6, holdMs = 0 } = {}) {
    const a = this.toClient(fromX, fromY);
    const b = this.toClient(fromX + dx, fromY + dy);
    await this.page.mouse.move(a.x, a.y);
    await this.page.mouse.down();
    for (let i = 1; i <= steps; i++) {
      await this.page.mouse.move(
        a.x + ((b.x - a.x) * i) / steps,
        a.y + ((b.y - a.y) * i) / steps,
      );
    }
    if (holdMs > 0) await this.page.waitForTimeout(holdMs);
    await this.page.mouse.up();
  }

  /**
   * Read a horizontal run of pixels out of the canvas, in LOGICAL coordinates,
   * together with the page clock reading taken in the same evaluate() call.
   *
   * The timestamp matters as much as the pixels: a sweep probe has to know when
   * the frame it is looking at was sampled, and pairing them in one round trip
   * keeps CDP latency out of the phase estimate.
   *
   * @returns {Promise<{ t: number, w: number, px: number[] }>} px is RGBA runs
   */
  async probeRow(y, { x0 = 0, x1 = null } = {}) {
    const xEnd = x1 ?? this.W;
    return this.page.evaluate(
      ({ y, x0, xEnd, W, H }) => {
        const c = document.querySelector('canvas');
        const ctx = c.getContext('2d');
        // The drawing buffer is W*dpr × H*dpr, so logical → buffer needs the
        // buffer's own ratio rather than devicePixelRatio (which can disagree
        // after a zoom).
        const sx = c.width / W;
        const sy = c.height / H;
        const bx = Math.round(x0 * sx);
        const bw = Math.max(1, Math.round((xEnd - x0) * sx));
        const by = Math.min(c.height - 1, Math.max(0, Math.round(y * sy)));
        const d = ctx.getImageData(bx, by, bw, 1).data;
        return { t: performance.now(), w: bw, px: Array.from(d) };
      },
      { y, x0, xEnd, W: this.W, H: this.H },
    );
  }

  /** As probeRow, but a vertical run at logical x. */
  async probeCol(x, { y0 = 0, y1 = null } = {}) {
    const yEnd = y1 ?? this.H;
    return this.page.evaluate(
      ({ x, y0, yEnd, W, H }) => {
        const c = document.querySelector('canvas');
        const ctx = c.getContext('2d');
        const sx = c.width / W;
        const sy = c.height / H;
        const bx = Math.min(c.width - 1, Math.max(0, Math.round(x * sx)));
        const by = Math.round(y0 * sy);
        const bh = Math.max(1, Math.round((yEnd - y0) * sy));
        const d = ctx.getImageData(bx, by, 1, bh).data;
        return { t: performance.now(), h: bh, px: Array.from(d) };
      },
      { x, y0, yEnd, W: this.W, H: this.H },
    );
  }

  /** Visible text of the whole screen — HUD, hints, and the end card. */
  async screenText() {
    return this.page.locator('body').innerText();
  }
}

/**
 * Find the brightest match for a target colour in a probed run, returned in
 * LOGICAL units. Used to locate a sweeping guide line on the canvas.
 *
 * Matching is nearest-colour with a tolerance rather than an exact hit: the
 * guides are drawn with glow/alpha (see fx.neonLine), so the pure colour only
 * appears at the core of the stroke, and anti-aliasing smears the edges.
 *
 * @param {{ px: number[], w?: number, h?: number }} run
 * @param {[number,number,number]} rgb
 * @param {{ tol?: number, span: number, from?: number }} opts
 *   span: logical length the run covers; from: logical coord of index 0
 * @returns {number|null} logical coordinate of the best match
 */
export function findColor(run, rgb, { tol = 60, span, from = 0 }) {
  const n = run.w ?? run.h;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const r = run.px[i * 4];
    const g = run.px[i * 4 + 1];
    const b = run.px[i * 4 + 2];
    const a = run.px[i * 4 + 3];
    if (a < 40) continue;
    const d = Math.abs(r - rgb[0]) + Math.abs(g - rgb[1]) + Math.abs(b - rgb[2]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0 || bestD > tol * 3) return null;
  return from + (best / n) * span;
}
