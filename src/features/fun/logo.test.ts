// @vitest-environment jsdom
// The canvas-games logo with NO platform default logo (BRANDING_DEFAULTS omits
// the trio): a tenant that uploaded nothing must get a clean no-op on every
// draw — no request for anyone's /brand/ assets, no crash, no half-drawn state
// — while an explicit branding logo still kicks off a load.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setOrg, type OrgInfo } from '../../lib/branding';
import { drawLogo, logoReady, logoAspect } from './logo';

function orgWith(branding: Record<string, string>): OrgInfo {
  return { id: 'org-3', slug: 'acme', name: 'Acme Golf', branding };
}

// The subset of CanvasRenderingContext2D drawLogo touches, all spies.
function fakeCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    drawImage: vi.fn(),
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D & { drawImage: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  setOrg(null);
});

describe('fun/logo without a tenant logo', () => {
  it('reports nothing to draw for every cut', () => {
    for (const variant of ['full', 'badge', 'wordmark'] as const) {
      expect(logoReady(variant)).toBe(false);
      expect(logoAspect(variant)).toBeNull();
    }
  });

  it('drawLogo is a clean no-op — no drawImage, no canvas state touched', () => {
    const ctx = fakeCtx();
    drawLogo(ctx, 170, 40, { width: 140, tint: '#123456' });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.save).not.toHaveBeenCalled();
  });

  it('an org with {} branding (defaults-only tenant) draws nothing either', () => {
    setOrg(orgWith({}));
    const ctx = fakeCtx();
    drawLogo(ctx, 0, 0, { width: 100 });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(logoReady()).toBe(false);
  });
});

describe('fun/logo with an explicit tenant logo', () => {
  it('starts loading the org asset but never draws before it decodes', () => {
    setOrg(orgWith({ logoUrl: '/uploads/acme.png' }));
    const ctx = fakeCtx();
    // jsdom never actually decodes images, so this pins the "still loading"
    // frame: the load was kicked off, and the frame renders logo-less.
    drawLogo(ctx, 0, 0, { width: 140 });
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(logoReady()).toBe(false);
  });
});
