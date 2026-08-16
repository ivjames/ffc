// @vitest-environment jsdom
// The theme-color meta has two candidate writers — branding (org themeColor)
// and mode (light/dark greys) — and exactly one rule arbitrates: an EXPLICIT
// themeColor in the org's raw branding owns the meta in both modes; otherwise
// the mode greys do, exactly as before multi-venue. These tests pin that rule
// against the flip-flop bug: last-writer-wins between setOrg and setMode.
import { describe, it, expect, beforeEach } from 'vitest';

import { setOrg, hasExplicitThemeColor, type OrgInfo } from './branding';
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
