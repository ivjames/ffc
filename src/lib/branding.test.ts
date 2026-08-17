// @vitest-environment jsdom
// The theme-color meta has two candidate writers — branding (org themeColor)
// and mode (light/dark greys) — and exactly one rule arbitrates: an EXPLICIT
// themeColor in the org's raw branding owns the meta in both modes; otherwise
// the mode greys do, exactly as before multi-venue. These tests pin that rule
// against the flip-flop bug: last-writer-wins between setOrg and setMode.
import { describe, it, expect, beforeEach } from 'vitest';

import {
  setOrg,
  getBranding,
  getExplicitLogoUrl,
  hasExplicitThemeColor,
  BRANDING_DEFAULTS,
  type OrgInfo,
} from './branding';
import { setMode, toggleMode } from './mode';

const DARK_GREY = '#2f2f2f';
const LIGHT_GREY = '#eaeaea';

function orgWith(branding: Record<string, string>): OrgInfo {
  return { id: 'org-1', slug: 'acme', name: 'Acme Golf', branding };
}

function metaContent(): string | null {
  return (
    document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null
  );
}

beforeEach(() => {
  localStorage.clear();
  setMode('dark');
  setOrg(null);
});

// The platform defaults must be venue-NEUTRAL (lockstep with
// server/lib/branding.js): no default logo at all, and a share footer that
// names no venue. Bullwinkle's identity lives in its OWN org branding row
// (schema.sql seed backfill) — a brand-new org with `{}` branding must not
// inherit it.
describe('neutral platform defaults', () => {
  it('an org with {} branding inherits no venue identity', () => {
    setOrg(orgWith({}));
    const b = getBranding();
    expect(b.shareFooter).toBe('Come beat this score');
    expect(b.logoUrl).toBeUndefined();
    expect(b.logoBadgeUrl).toBeUndefined();
    expect(b.logoWordmarkUrl).toBeUndefined();
    expect(getExplicitLogoUrl()).toBeNull();
    expect(getExplicitLogoUrl('badge')).toBeNull();
    expect(JSON.stringify(b)).not.toMatch(/bullwinkle|\/brand\//i);
  });

  it('no org at all (pure defaults) is just as neutral', () => {
    setOrg(null);
    expect(getBranding().shareFooter).toBe('Come beat this score');
    expect(getBranding().logoUrl).toBeUndefined();
    expect(JSON.stringify(BRANDING_DEFAULTS)).not.toMatch(/bullwinkle|\/brand\//i);
  });

  it('everything WITH a platform default keeps the stock values', () => {
    setOrg(orgWith({}));
    const b = getBranding();
    expect(b.appName).toBe('Mini Golf Scorecard');
    expect(b.shortName).toBe('MiniGolf');
    expect(b.themeColor).toBe('#15803d');
    expect(b.backgroundColor).toBe('#052e16');
    expect(b.accentColor).toBe('#38bdf8');
    expect(b.icon192Url).toBe('/icons/icon-192.png');
    expect(b.icon512Url).toBe('/icons/icon-512.png');
  });

  it('an org that DID set footer/logo merges them over the defaults', () => {
    setOrg(orgWith({ shareFooter: 'Acme · beat it', logoUrl: '/uploads/acme.png' }));
    expect(getBranding().shareFooter).toBe('Acme · beat it');
    expect(getBranding().logoUrl).toBe('/uploads/acme.png');
    expect(getBranding().logoBadgeUrl).toBeUndefined(); // unset cut stays absent
    expect(getExplicitLogoUrl()).toBe('/uploads/acme.png');
    expect(getBranding().appName).toBe('Mini Golf Scorecard'); // untouched keys keep defaults
  });
});

describe('theme-color meta ownership', () => {
  it('explicit org themeColor wins over both modes', () => {
    setOrg(orgWith({ themeColor: '#123456' }));
    expect(hasExplicitThemeColor()).toBe(true);
    expect(metaContent()).toBe('#123456');

    setMode('light');
    expect(metaContent()).toBe('#123456');
    setMode('dark');
    expect(metaContent()).toBe('#123456');
  });

  it('the merged default themeColor does NOT count as explicit', () => {
    // Branding present but no themeColor key: getBranding() resolves the
    // platform default (#15803d), yet the meta must stay on the mode greys.
    setOrg(orgWith({ appName: 'Acme Golf' }));
    expect(hasExplicitThemeColor()).toBe(false);
    expect(metaContent()).toBe(DARK_GREY);
    setMode('light');
    expect(metaContent()).toBe(LIGHT_GREY);
  });

  it('empty branding follows the mode greys through a toggle', () => {
    setOrg(orgWith({}));
    expect(hasExplicitThemeColor()).toBe(false);
    expect(metaContent()).toBe(DARK_GREY);

    toggleMode();
    expect(metaContent()).toBe(LIGHT_GREY);
    toggleMode();
    expect(metaContent()).toBe(DARK_GREY);
  });

  it('hydrate after a toggle does not stomp the grey when branding is empty', () => {
    setOrg(orgWith({}));
    setMode('light');
    expect(metaContent()).toBe(LIGHT_GREY);

    // Live /api/content hydrate re-runs setOrg; with no explicit themeColor
    // the user's mode choice must survive it.
    setOrg(orgWith({}));
    expect(metaContent()).toBe(LIGHT_GREY);
  });

  it('dropping the explicit themeColor hands the meta back to the mode greys', () => {
    setOrg(orgWith({ themeColor: '#123456' }));
    setMode('light');
    expect(metaContent()).toBe('#123456');

    setOrg(orgWith({}));
    expect(hasExplicitThemeColor()).toBe(false);
    expect(metaContent()).toBe(LIGHT_GREY);
  });
});
