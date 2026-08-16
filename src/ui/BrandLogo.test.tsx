// @vitest-environment jsdom
// The white-label hero/drawer logo. The contract worth pinning: the logo only
// renders when the org EXPLICITLY set one in its raw branding — the merged
// BRANDING_DEFAULTS (the default tenant's own assets) must never leak onto
// another tenant — and every no-logo path (nothing set, image 404) lands on
// the caller's fallback instead of a broken image.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import BrandLogo from './BrandLogo';
import { setOrg, type OrgInfo } from '../lib/branding';

function orgWith(branding: Record<string, string>): OrgInfo {
  return { id: 'org-2', slug: 'keystone', name: 'Keystone Allentown', branding };
}

// Mirrors the Home hero's usage: emoji stands in when there's no logo.
const EMOJI = <span data-testid="hero-emoji">🎡</span>;

beforeEach(() => {
  setOrg(null);
});
afterEach(cleanup);

describe('BrandLogo', () => {
  it('renders the uploaded logo when the org branding sets one explicitly', () => {
    setOrg(orgWith({ logoUrl: '/uploads/keystone.png' }));
    render(<BrandLogo fallback={EMOJI} />);

    const img = screen.getByRole('img', { name: 'Keystone Allentown' });
    expect(img).toHaveAttribute('src', '/uploads/keystone.png');
    expect(screen.queryByTestId('hero-emoji')).not.toBeInTheDocument();
  });

  it('falls back to the emoji when branding has no logo key — the merged default must not count', () => {
    // Branding present (so getBranding().logoUrl resolves the default moose
    // path) but no raw logo key: a non-default tenant that hasn't uploaded a
    // logo must get the neutral emoji, not Bullwinkle's assets.
    setOrg(orgWith({ appName: 'Keystone Fun Works', themeColor: '#123456' }));
    render(<BrandLogo fallback={EMOJI} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('hero-emoji')).toBeInTheDocument();
  });

  it('falls back with no org at all (pure defaults)', () => {
    render(<BrandLogo fallback={EMOJI} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('hero-emoji')).toBeInTheDocument();
  });

  it('drops to the fallback when the image errors, and retries on a hydrate that swaps the URL', () => {
    setOrg(orgWith({ logoUrl: '/uploads/missing.png' }));
    render(<BrandLogo fallback={EMOJI} />);

    // The URL 404s (offline cache miss, deleted upload) — emoji takes over.
    fireEvent.error(screen.getByRole('img'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('hero-emoji')).toBeInTheDocument();

    // The failure latch is per URL: a live hydrate with a NEW logo retries.
    act(() => {
      setOrg(orgWith({ logoUrl: '/uploads/fixed.png' }));
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/fixed.png');
  });

  it('re-renders when branding hydrates in after mount (revision subscription)', () => {
    render(<BrandLogo fallback={EMOJI} />);
    expect(screen.getByTestId('hero-emoji')).toBeInTheDocument();

    // /api/content lands after first paint and the org carries a logo.
    act(() => {
      setOrg(orgWith({ logoUrl: '/uploads/late.png' }));
    });
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/late.png');
    expect(screen.queryByTestId('hero-emoji')).not.toBeInTheDocument();
  });

  it('prefers the badge cut for square slots, crossing over when only one cut exists', () => {
    setOrg(orgWith({ logoUrl: '/uploads/full.png', logoBadgeUrl: '/uploads/badge.png' }));
    const { unmount } = render(<BrandLogo prefer="badge" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/badge.png');
    unmount();

    // Only the full cut uploaded: the badge slot still brands with it.
    act(() => {
      setOrg(orgWith({ logoUrl: '/uploads/full.png' }));
    });
    render(<BrandLogo prefer="badge" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/uploads/full.png');
  });
});
