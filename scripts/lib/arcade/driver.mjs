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
   * Tap, and bracket the press with page-clock readings.
   *
   * The two-axis timing games rebase their sweep clock to performance.now()
   * inside the pointerdown handler, so the tap itself is the phase reference for
   * whatever comes next. The handler runs during mouse.down(), somewhere between
   * these two readings; the midpoint is the best available estimate, and the
   * spread is the uncertainty it carries.
   *
   * @returns {Promise<{ t: number, spread: number }>} page time of the press
   */
  async tapTimed(x, y) {
    const p = this.toClient(x, y);
    await this.page.mouse.move(p.x, p.y);
    const t0 = await this.pageNow();
    await this.page.mouse.down();
    const t1 = await this.pageNow();
    await this.page.mouse.up();
    return { t: (t0 + t1) / 2, spread: t1 - t0 };
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

  /**
   * Sample an arbitrary set of logical points in ONE round trip.
   *
   * This is the primitive the reactive games need. A game with entities moving
   * between fixed places (whack-a-mole's nine holes, a shooting gallery's
   * shelves) is played by re-reading those places every cycle and acting on
   * what is there — and that only works if the whole read is one evaluate().
   * Nine separate probes would cost nine CDP round trips per cycle, which is
   * slower than the thing being reacted to.
   *
   * @param {Array<{x:number,y:number}>} pts logical coordinates
   * @returns {Promise<{ t: number, px: Array<[number,number,number,number]> }>}
   */
  async probePoints(pts) {
    return this.page.evaluate(
      ({ pts, W, H }) => {
        const c = document.querySelector('canvas');
        const ctx = c.getContext('2d');
        const sx = c.width / W;
        const sy = c.height / H;
        const px = pts.map((p) => {
          const bx = Math.min(c.width - 1, Math.max(0, Math.round(p.x * sx)));
          const by = Math.min(c.height - 1, Math.max(0, Math.round(p.y * sy)));
          const d = ctx.getImageData(bx, by, 1, 1).data;
          return [d[0], d[1], d[2], d[3]];
        });
        return { t: performance.now(), px };
      },
      { pts, W: this.W, H: this.H },
    );
  }

  /**
   * Centroid of every pixel matching an RGB box inside a region — computed
   * IN-PAGE from a single getImageData, returning only the answer.
   *
   * This is the primitive for the ball games. Locating a puck or a pinball
   * means searching two dimensions, and the naive versions are both hopeless:
   * a lattice of probePoints costs one getImageData per point, and a stack of
   * probeRow scans costs a CDP round trip per row. Doing the whole search
   * inside one evaluate keeps a full-table find at roughly the cost of a
   * single row probe, which is what makes chasing an 800px/s puck viable.
   *
   * @param {{x0:number,y0:number,x1:number,y1:number}} region logical bounds
   * @param {{rMin?:number,rMax?:number,gMin?:number,gMax?:number,bMin?:number,bMax?:number}} spec
   * @param {{step?:number}} opts step samples every Nth pixel (default 2)
   * @returns {Promise<{t:number, x:number, y:number, n:number}|null>} null if unseen
   */
  async findBlob(region, spec, { step = 2 } = {}) {
    return this.page.evaluate(
      ({ region, spec, step, W, H }) => {
        const c = document.querySelector('canvas');
        if (!c) return null;
        const ctx = c.getContext('2d');
        const sx = c.width / W;
        const sy = c.height / H;
        const bx = Math.max(0, Math.round(region.x0 * sx));
        const by = Math.max(0, Math.round(region.y0 * sy));
        const bw = Math.min(c.width - bx, Math.round((region.x1 - region.x0) * sx));
        const bh = Math.min(c.height - by, Math.round((region.y1 - region.y0) * sy));
        if (bw <= 0 || bh <= 0) return null;
        const d = ctx.getImageData(bx, by, bw, bh).data;
        const rMin = spec.rMin ?? 0, rMax = spec.rMax ?? 255;
        const gMin = spec.gMin ?? 0, gMax = spec.gMax ?? 255;
        const bMin = spec.bMin ?? 0, bMax = spec.bMax ?? 255;
        let n = 0, sumX = 0, sumY = 0;
        for (let py = 0; py < bh; py += step) {
          for (let px = 0; px < bw; px += step) {
            const i = (py * bw + px) * 4;
            if (d[i + 3] < 60) continue;
            const r = d[i], g = d[i + 1], b = d[i + 2];
            if (r < rMin || r > rMax || g < gMin || g > gMax || b < bMin || b > bMax) continue;
            n++;
            sumX += px;
            sumY += py;
          }
        }
        if (n === 0) return null;
        return {
          t: performance.now(),
          x: region.x0 + (sumX / n) / sx,
          y: region.y0 + (sumY / n) / sy,
          n,
        };
      },
      { region, spec, step, W: this.W, H: this.H },
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
