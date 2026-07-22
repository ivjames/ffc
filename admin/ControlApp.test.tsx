import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ControlApp from './ControlApp';
import { api, getToken } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      me: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      overview: vi.fn(),
    },
  };
});

const SUPER_ADMIN_USER = {
  id: 'u-1',
  email: 'super@example.com',
  role: 'super_admin' as const,
  orgId: null,
  viaToken: false,
};
const ORG_ADMIN_USER = {
  id: 'u-2',
  email: 'org@example.com',
  role: 'org_admin' as const,
  orgId: 'org-1',
  viaToken: false,
};
const TOKEN_USER = { id: null, email: null, role: 'super_admin' as const, orgId: null, viaToken: true };

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api.me).mockReset();
  vi.mocked(api.login).mockReset();
  vi.mocked(api.logout).mockReset().mockResolvedValue({ ok: true });
  vi.mocked(api.overview)
    .mockReset()
    .mockResolvedValue({
      totals: { orgs: 0, locations: 0, courses: 0, roundsActive: 0, rounds7d: 0, rounds30d: 0, huntFinds: 0 },
      perLocation: [],
    });
});

function renderApp() {
  return render(
    <MemoryRouter>
      <ControlApp />
    </MemoryRouter>
  );
}

describe('initial load', () => {
  test('shows nothing while the initial /me check is pending', async () => {
    let resolveMe: (v: any) => void = () => {};
    vi.mocked(api.me).mockReturnValue(new Promise((r) => (resolveMe = r)));
    const { container } = renderApp();
    expect(container).toBeEmptyDOMElement();
    await act(async () => resolveMe({ ok: true, user: SUPER_ADMIN_USER }));
  });

  test('an existing valid session (/me succeeds) goes straight to the Shell', async () => {
    vi.mocked(api.me).mockResolvedValue({ ok: true, user: SUPER_ADMIN_USER });
    renderApp();
    expect(await screen.findByText('FFC · Master Control')).toBeInTheDocument();
    expect(screen.getByText('super@example.com')).toBeInTheDocument();
  });

  test('no session (/me 401s) shows the sign-in gate', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthorized'));
    renderApp();
    expect(await screen.findByText('Enter the admin token to continue.')).toBeInTheDocument();
  });
});

describe('login flow', () => {
  test('successful login shows the Shell with the returned user, including org_admin tag', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthorized'));
    vi.mocked(api.login).mockResolvedValue({ ok: true, user: ORG_ADMIN_USER });
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('Enter the admin token to continue.');
    await user.click(screen.getByText('Log in with email and password instead'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'org@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'whatever-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText(/org@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/org admin/)).toBeInTheDocument();
  });

  test('a failed login shows the real server error and stays on the gate', async () => {
    vi.mocked(api.me).mockRejectedValue(new Error('unauthorized'));
    const { AuthError } = await vi.importActual<typeof import('./api')>('./api');
    vi.mocked(api.login).mockRejectedValue(new AuthError('invalid email or password'));
    const user = userEvent.setup();
    renderApp();

    await screen.findByText('Enter the admin token to continue.');
    await user.click(screen.getByText('Log in with email and password instead'));
    await user.type(screen.getByPlaceholderText('you@example.com'), 'org@example.com');
    await user.type(screen.getByPlaceholderText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('invalid email or password')).toBeInTheDocument();
    expect(screen.queryByText('FFC · Master Control')).not.toBeInTheDocument();
  });
});

describe('token flow', () => {
  test('submitting a token unlocks immediately, then resolves the real role in the background', async () => {
    vi.mocked(api.me).mockRejectedValueOnce(new Error('unauthorized'));
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Enter the admin token to continue.');

    let resolveMe: (v: any) => void = () => {};
    vi.mocked(api.me).mockReturnValue(new Promise((r) => (resolveMe = r)));

    await user.type(screen.getByPlaceholderText('APP_TOKEN'), 'my-token');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    // Unlocked immediately (optimistic) — before the background /me resolves.
    expect(await screen.findByText('FFC · Master Control')).toBeInTheDocument();
    expect(getToken()).toBe('my-token');

    await act(async () => resolveMe({ ok: true, user: TOKEN_USER }));
    expect(await screen.findByText('Admin token')).toBeInTheDocument();
  });

  test('a bad token bounces back to the gate once the background /me check fails', async () => {
    vi.mocked(api.me).mockRejectedValueOnce(new Error('unauthorized'));
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Enter the admin token to continue.');

    // A controlled promise, not an instantly-rejecting mock: with a real
    // network round-trip (or this), the optimistic unlock is observable
    // before the background check resolves. An instantly-rejecting mock
    // collapses both state transitions into a single React batch, so the
    // intermediate "unlocked" render never actually paints — a test
    // artifact, not a real product behavior difference.
    let rejectMe: (err: unknown) => void = () => {};
    vi.mocked(api.me).mockReturnValueOnce(new Promise((_, rej) => (rejectMe = rej)));
    await user.type(screen.getByPlaceholderText('APP_TOKEN'), 'bad-token');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await screen.findByText('FFC · Master Control'); // optimistic unlock first
    await act(async () => rejectMe(new Error('unauthorized')));

    expect(await screen.findByText('Enter the admin token to continue.')).toBeInTheDocument();
    expect(getToken()).toBe('');
  });
});

describe('global sign-out event', () => {
  test('dispatching ffc-admin-unauthorized drops back to the gate', async () => {
    vi.mocked(api.me).mockResolvedValue({ ok: true, user: SUPER_ADMIN_USER });
    renderApp();
    await screen.findByText('FFC · Master Control');

    act(() => {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
    });

    expect(await screen.findByText('Enter the admin token to continue.')).toBeInTheDocument();
  });
});

describe('lock', () => {
  test('clicking Lock calls api.logout and returns to the gate', async () => {
    vi.mocked(api.me).mockResolvedValue({ ok: true, user: SUPER_ADMIN_USER });
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('FFC · Master Control');

    await user.click(screen.getByRole('button', { name: 'Lock' }));

    expect(await screen.findByText('Enter the admin token to continue.')).toBeInTheDocument();
    expect(api.logout).toHaveBeenCalledOnce();
  });
});
