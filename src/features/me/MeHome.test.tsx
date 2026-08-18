// @vitest-environment jsdom
// The Me hub, from the signed-out side. Which rows a guest sees is a product
// decision with a history: account-only rows are hidden rather than shown and
// then refused, while Achievements is open because the badges are earned by
// playing and mostly detected on the device itself.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MeHome from './MeHome';
import type { SessionState } from '../../lib/session';

const sessionState = vi.fn<() => SessionState>();
vi.mock('../../lib/session', () => ({ useSession: () => sessionState() }));
vi.mock('../../lib/pos', () => ({ usePos: () => ({ loyalty: null, ordering: null }) }));
vi.mock('../../lib/pwaInstall', () => ({ isStandalone: () => true }));

const renderHub = () =>
  render(
    <MemoryRouter initialEntries={['/me']}>
      <MeHome />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('MeHome', () => {
  it('offers achievements to a guest, but not the account-only rows', () => {
    sessionState.mockReturnValue({ user: null, known: true, loading: false });
    renderHub();
    expect(screen.getByText('Achievements')).toBeInTheDocument();
    expect(screen.getByText('Sign in / register')).toBeInTheDocument();
    expect(screen.queryByText('My teams')).not.toBeInTheDocument();
  });

  it('shows the account rows once there is an account', () => {
    sessionState.mockReturnValue({
      user: {
        id: 'u1',
        email: 'sam@example.test',
        displayName: 'Sam',
        defaultTag: 'SAM',
        emailVerifiedAt: '2026-01-01T00:00:00Z',
      },
      known: true,
      loading: false,
    });
    renderHub();
    expect(screen.getByText('Achievements')).toBeInTheDocument();
    expect(screen.getByText('My teams')).toBeInTheDocument();
  });
});
