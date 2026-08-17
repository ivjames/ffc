import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SetPassword from './SetPassword';
import { api } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return {
    ...actual,
    api: {
      checkPasswordToken: vi.fn(),
      setPassword: vi.fn(),
    },
  };
});

const TOKEN = 'a'.repeat(64);
const USER = { id: 'u-1', email: 'owner@example.com', role: 'org_admin' as const, orgId: 'org-1' };

beforeEach(() => {
  vi.mocked(api.checkPasswordToken).mockReset();
  vi.mocked(api.setPassword).mockReset();
});

function renderPage(onDone = vi.fn(), url = `/set-password?token=${TOKEN}`) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <SetPassword onDone={onDone} />
    </MemoryRouter>
  );
  return onDone;
}

const INVALID_COPY = 'This link has expired or was already used. Request a new one from the sign-in page.';

describe('SetPassword', () => {
  test('a valid token shows the form with the account email', async () => {
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    renderPage();

    expect(await screen.findByText(/Set a password for/)).toBeInTheDocument();
    expect(screen.getByText('owner@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm password')).toBeInTheDocument();
    expect(api.checkPasswordToken).toHaveBeenCalledWith(TOKEN);
  });

  test('a rejected token check shows the invalid view', async () => {
    const { ApiError } = await vi.importActual<typeof import('./api')>('./api');
    vi.mocked(api.checkPasswordToken).mockRejectedValue(new ApiError('link expired or already used'));
    renderPage();

    expect(await screen.findByText(INVALID_COPY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go to sign-in' })).toBeInTheDocument();
  });

  test('a missing token goes straight to the invalid view without calling the API', async () => {
    renderPage(vi.fn(), '/set-password');

    expect(await screen.findByText(INVALID_COPY)).toBeInTheDocument();
    expect(api.checkPasswordToken).not.toHaveBeenCalled();
  });

  test('a short password shows an inline error and blocks submit', async () => {
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Set a password for/);

    await user.type(screen.getByPlaceholderText('New password'), 'short');
    await user.type(screen.getByPlaceholderText('Confirm password'), 'short');

    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  test('mismatched passwords show an inline error and block submit', async () => {
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Set a password for/);

    await user.type(screen.getByPlaceholderText('New password'), 'long-enough-1');
    await user.type(screen.getByPlaceholderText('Confirm password'), 'long-enough-2');

    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Set password' }));
    expect(api.setPassword).not.toHaveBeenCalled();
  });

  test('a valid submit calls setPassword and hands the auto-logged-in user to onDone', async () => {
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    vi.mocked(api.setPassword).mockResolvedValue({ ok: true, user: USER });
    const user = userEvent.setup();
    const onDone = renderPage();
    await screen.findByText(/Set a password for/);

    await user.type(screen.getByPlaceholderText('New password'), 'long-enough-1');
    await user.type(screen.getByPlaceholderText('Confirm password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(USER));
    expect(api.setPassword).toHaveBeenCalledWith(TOKEN, 'long-enough-1');
  });

  test('setPassword rejecting as expired/used flips to the invalid view', async () => {
    const { ApiError } = await vi.importActual<typeof import('./api')>('./api');
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    vi.mocked(api.setPassword).mockRejectedValue(new ApiError('link expired or already used'));
    const user = userEvent.setup();
    const onDone = renderPage();
    await screen.findByText(/Set a password for/);

    await user.type(screen.getByPlaceholderText('New password'), 'long-enough-1');
    await user.type(screen.getByPlaceholderText('Confirm password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText(INVALID_COPY)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('any other setPassword failure shows the server message and keeps the form', async () => {
    const { ApiError } = await vi.importActual<typeof import('./api')>('./api');
    vi.mocked(api.checkPasswordToken).mockResolvedValue({ ok: true, email: 'owner@example.com' });
    vi.mocked(api.setPassword).mockRejectedValue(new ApiError('password too weak'));
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Set a password for/);

    await user.type(screen.getByPlaceholderText('New password'), 'long-enough-1');
    await user.type(screen.getByPlaceholderText('Confirm password'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'Set password' }));

    expect(await screen.findByText('password too weak')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('New password')).toBeInTheDocument();
  });
});
