// @vitest-environment jsdom
// The adoption nudge's install pitch. What's worth pinning after the
// white-label QA pass: the "buzz you when your food is ready" clause is only
// promised at venues whose POS config actually offers in-app ordering — at any
// other tenant the pitch stays generic and never mentions food.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdoptionNudge from './AdoptionNudge';
import { usePos, type PosCapabilities } from '../lib/pos';
import { useInstallPrompt } from '../lib/pwaInstall';
import type { OrderingApi } from '../lib/pos/types';

// The venue capability under test comes from mocked POS config, not the DEV
// fallback (which turns everything on and would mask the gate).
vi.mock('../lib/pos', () => ({ usePos: vi.fn() }));
// Not installed, no native prompt — the install nudge is eligible.
vi.mock('../lib/pwaInstall', () => ({ useInstallPrompt: vi.fn() }));
// Funnel events go to the network; irrelevant here.
vi.mock('../lib/analytics', () => ({ track: vi.fn() }));

function caps(ordering: boolean): PosCapabilities {
  return { ordering: ordering ? ({} as OrderingApi) : null, loyalty: false, gameRewards: false };
}

function renderNudge(props: Partial<Parameters<typeof AdoptionNudge>[0]> = {}) {
  return render(
    <MemoryRouter>
      <AdoptionNudge signedIn={false} authChecked={true} {...props} />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear(); // no dismissals banked — the nudge shows
  vi.mocked(useInstallPrompt).mockReturnValue({
    platform: 'android',
    installed: false,
    canPrompt: false,
    promptInstall: async () => null,
  });
  vi.mocked(usePos).mockReturnValue(caps(false));
});
afterEach(cleanup);

describe('AdoptionNudge install pitch', () => {
  it('promises the food buzz at a venue with in-app ordering', () => {
    vi.mocked(usePos).mockReturnValue(caps(true));
    renderNudge();

    expect(screen.getByText('Add the app to your phone')).toBeInTheDocument();
    expect(screen.getByText(/buzz you when your food is ready/i)).toBeInTheDocument();
  });

  it('never mentions food at a venue without ordering', () => {
    renderNudge();

    expect(screen.getByText('Add the app to your phone')).toBeInTheDocument();
    expect(screen.queryByText(/food/i)).not.toBeInTheDocument();
    // The pitch still sells the install on its universal merits.
    expect(screen.getByText(/works offline/i)).toBeInTheDocument();
  });

  it('leaves the sign-in nudge copy alone', () => {
    // Already installed → the sign-in nudge is the one that shows.
    vi.mocked(useInstallPrompt).mockReturnValue({
      platform: 'android',
      installed: true,
      canPrompt: false,
      promptInstall: async () => null,
    });
    renderNudge();

    expect(screen.getByText('Save your scores & rewards')).toBeInTheDocument();
    expect(
      screen.getByText(/keep your rounds and tickets with you across every visit/i)
    ).toBeInTheDocument();
  });
});
