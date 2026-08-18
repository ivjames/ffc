import { describe, test, expect, vi } from 'vitest';
import { ICON_SPECS, artworkBox, deriveAppIcons, renderIcon } from './appIcon';

describe('artworkBox', () => {
  test('centres a square logo and fills the content box', () => {
    const b = artworkBox(512, 100, 100, 0.5);
    expect(b.w).toBe(256);
    expect(b.h).toBe(256);
    expect(b.x).toBe(128);
    expect(b.y).toBe(128);
  });

  test('preserves aspect — a wordmark stays wide, not stretched square', () => {
    const b = artworkBox(192, 400, 100, 0.8);
    expect(b.w / b.h).toBeCloseTo(4, 5);
    // Contained: the long axis hits the box, the short axis is centred inside it.
    expect(b.w).toBeCloseTo(192 * 0.8, 5);
    expect(b.x).toBeCloseTo((192 - b.w) / 2, 5);
    expect(b.y).toBeCloseTo((192 - b.h) / 2, 5);
  });

  test('never overflows the square, whatever the source aspect', () => {
    for (const [w, h] of [[1, 1000], [1000, 1], [37, 91], [2048, 2048]]) {
      const b = artworkBox(512, w, h, ICON_SPECS[1].contentRatio);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(512.0001);
      expect(b.y + b.h).toBeLessThanOrEqual(512.0001);
    }
  });

  test('survives an SVG that reports no intrinsic size', () => {
    const b = artworkBox(192, 0, 0, 0.8);
    expect(Number.isFinite(b.w)).toBe(true);
    expect(b.w).toBeGreaterThan(0);
  });
});

describe('maskable safe zone', () => {
  // The 512 is declared `purpose: "maskable"` in server/routes/manifest.js, so
  // Android may crop it to a circle of radius 40% of the side. Artwork outside
  // that circle is CUT — and nobody finds out until it is on a phone. This is
  // the check that keeps the constant honest if someone "tidies" it later.
  test('the 512 keeps every corner of the artwork inside the safe circle', () => {
    const spec = ICON_SPECS.find((s) => s.kind === 'icon512')!;
    const { x, y, w, h } = artworkBox(spec.side, 100, 100, spec.contentRatio);
    const c = spec.side / 2;
    const safeRadius = spec.side * 0.4;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      expect(Math.hypot(px - c, py - c)).toBeLessThanOrEqual(safeRadius + 0.0001);
    }
  });

  test('the 192 is any-purpose, so it may use more of the square', () => {
    const a = ICON_SPECS.find((s) => s.kind === 'icon192')!;
    const b = ICON_SPECS.find((s) => s.kind === 'icon512')!;
    expect(a.contentRatio).toBeGreaterThan(b.contentRatio);
  });

  test('both icons are the exact sizes the server will demand', () => {
    expect(ICON_SPECS.map((s) => s.side)).toEqual([192, 512]);
  });
});

/** A canvas stub: jsdom has no 2D context, and we only care about the calls. */
function stubCanvas(blob: Blob | null) {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toBlob: (cb: (b: Blob | null) => void) => cb(blob),
  };
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) =>
    tag === 'canvas' ? canvas : document.createElementNS('http://www.w3.org/1999/xhtml', tag)) as never);
  return { canvas, ctx };
}

describe('renderIcon', () => {
  const img = { naturalWidth: 200, naturalHeight: 200 } as HTMLImageElement;

  test('paints the background before the logo, at the requested size', async () => {
    const { canvas, ctx } = stubCanvas(new Blob(['x'], { type: 'image/png' }));
    await renderIcon(img, ICON_SPECS[0], '#052e16');
    expect(canvas.width).toBe(192);
    expect(canvas.height).toBe(192);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 192, 192);
    expect(ctx.drawImage).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  // A logo on someone else's CDN taints the canvas and toBlob yields nothing.
  // The operator needs to be told to upload the file, not shown a silent no-op.
  test('explains itself when the canvas is tainted by a cross-origin logo', async () => {
    stubCanvas(null);
    await expect(renderIcon(img, ICON_SPECS[0], '#000')).rejects.toThrow(/another domain/i);
    vi.restoreAllMocks();
  });
});

describe('deriveAppIcons', () => {
  test('returns both kinds as PNG Files named for their size', async () => {
    stubCanvas(new Blob(['x'], { type: 'image/png' }));
    // Resolve loadImage without a network: jsdom never fires load on its own.
    const proto = globalThis.Image.prototype as unknown as { src: string };
    Object.defineProperty(proto, 'src', {
      configurable: true,
      set(this: HTMLImageElement) {
        Object.defineProperty(this, 'naturalWidth', { value: 300, configurable: true });
        Object.defineProperty(this, 'naturalHeight', { value: 120, configurable: true });
        queueMicrotask(() => this.onload?.(new Event('load')));
      },
    });

    const out = await deriveAppIcons('/api/brand-assets/org-1/logo-abc.png', '#052e16');
    expect(out.map((o) => o.kind)).toEqual(['icon192', 'icon512']);
    expect(out.map((o) => o.file.name)).toEqual(['icon-192.png', 'icon-512.png']);
    expect(out.every((o) => o.file.type === 'image/png')).toBe(true);
    vi.restoreAllMocks();
  });
});
