// @vitest-environment jsdom
// The account gate: which side of it a visitor lands on. The case worth
// pinning down is the third one — an inconclusive session check must never be
// treated as "signed out", or a signed-in player who is momentarily offline
// gets walled out of their own card.
//
// The session store itself is module-level shared state, so it's mocked here
// and covered on its own in src/lib/session.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import AccountGate from './AccountGate';
import type { SessionState } from '../../lib/session';

const sessionState = vi.fn<() => SessionState>();
const refreshSession = vi.fn();
vi.mock('../../lib/session', () => ({
  useSession: () => sessionState(),
  refreshSession: () => refreshSession(),
}));

const USER = {
  id: 'u1',
  email: 'sam@example.com',
  displayName: 'Sam',
  defaultTag: 'SAM',
  emailVerifiedAt: '2026-01-01T00:00:00Z',
};

function renderGate() {
  return render(
    <MemoryRouter initialEntries={['/me/rewards']}>
      <Routes>
        <Route element={<AccountGate />}>
          <Route path="/me/rewards" element={<div>REWARDS CARD</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AccountGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // This config doesn't auto-cleanup, so an earlier render would otherwise
  // still be mounted and every "is it absent?" assertion would be meaningless.
  afterEach(() => {
    cleanup();
  });

  it('renders the gated screen for a signed-in player', () => {
    sessionState.mockReturnValue({ user: USER, known: true, loading: false });
    renderGate();
    expect(screen.getByText('REWARDS CARD')).toBeTruthy();
  });

  it('shows the sign-in wall when the player is authoritatively signed out', () => {
    sessionState.mockReturnValue({ user: null, known: true, loading: false });
    renderGate();
    expect(screen.getByText('Sign in to continue')).toBeTruthy();
    expect(screen.queryByText('REWARDS CARD')).toBeNull();
  });

  it('waits, rather than walling, while the check is still in flight', () => {
    sessionState.mockReturnValue({ user: null, known: false, loading: true });
    renderGate();
    expect(screen.getByText('Checking your account…')).toBeTruthy();
    expect(screen.queryByText('Sign in to continue')).toBeNull();
    expect(screen.queryByText('REWARDS CARD')).toBeNull();
  });

  it('offers a retry rather than a sign-in wall when the check is inconclusive', () => {
    // Offline / 5xx: `known` stays false. A sign-in wall here would be a lie.
    sessionState.mockReturnValue({ user: null, known: false, loading: false });
    renderGate();
    expect(screen.getByText('Couldn’t reach your account')).toBeTruthy();
    expect(screen.queryByText('Sign in to continue')).toBeNull();
    expect(screen.queryByText('REWARDS CARD')).toBeNull();
  });
});
